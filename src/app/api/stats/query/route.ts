import { NextResponse } from 'next/server';
import { executeQuerySpec } from '@/lib/stat-query/executor';
import { loadParserContext } from '@/lib/stat-query/context';
import { analyticsRevision, cacheKey, checkDurableRateLimit, getCachedResult, rateLimitKey, setCachedResult, withStatQueryTimeout, writeQueryTelemetry } from '@/lib/stat-query/operations';
import { parseStatQuestion } from '@/lib/stat-query/parser';
import { inputPolicyError, STAT_QUERY_LIMITS } from '@/lib/stat-query/policy';
import { askCentrePassEnabled } from '@/lib/server-feature-flags';
import type { ParseResult } from '@/lib/stat-query/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 1_024;
const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

function jsonResponse(payload: unknown, status = 200, headers?: Record<string, string>): NextResponse {
  return NextResponse.json(payload, { status, headers: { ...RESPONSE_HEADERS, ...headers } });
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  retryable = false,
  headers?: Record<string, string>,
): NextResponse {
  return jsonResponse({ error: { code, message, retryable } }, status, headers);
}

function clientIdentifier(request: Request): string {
  // Use the final forwarded address: a reverse proxy appends the peer it
  // actually observed, while an attacker may control earlier values.
  const forwardedChain = request.headers.get('x-forwarded-for')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const candidate = forwardedChain?.at(-1)
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';
  return candidate.trim().slice(0, 128) || 'unknown';
}

function resultCount(result: unknown): number {
  if (!result || typeof result !== 'object') return 0;
  const value = result as { entries?: unknown[]; metrics?: unknown[]; value?: unknown; entry?: unknown };
  if (Array.isArray(value.entries)) return value.entries.length;
  if (Array.isArray(value.metrics)) return value.metrics.length;
  return value.value || value.entry ? 1 : 0;
}

async function readQuestion(request: Request): Promise<{ question: string } | NextResponse> {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return errorResponse('CROSS_ORIGIN_REQUEST', 'Cross-origin statistical queries are not allowed.', 403);
  }
  const contentType = request.headers.get('content-type')
    ?.split(';')[0]
    ?.trim()
    .toLocaleLowerCase() ?? '';
  if (contentType !== 'application/json') {
    return errorResponse('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.', 415);
  }
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return errorResponse('BODY_TOO_LARGE', `Request bodies are limited to ${MAX_BODY_BYTES} bytes.`, 413);
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return errorResponse('BODY_TOO_LARGE', `Request bodies are limited to ${MAX_BODY_BYTES} bytes.`, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse('INVALID_JSON', 'Request body must contain valid JSON.', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse('INVALID_BODY', 'Request body must be an object.', 400);
  }
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'question') {
    return errorResponse('INVALID_BODY', 'Request body must contain only question.', 400);
  }
  const question = (body as { question?: unknown }).question;
  if (typeof question !== 'string') {
    return errorResponse('INVALID_BODY', 'question must be a string.', 400);
  }
  return { question: question.replace(/\s+/g, ' ').trim() };
}

async function writeTelemetryWithoutFailingRequest(
  input: Parameters<typeof writeQueryTelemetry>[0],
): Promise<void> {
  try {
    await writeQueryTelemetry(input);
  } catch {
    console.warn('[Ask CentrePass] telemetry write failed');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!askCentrePassEnabled()) {
    return errorResponse('FEATURE_DISABLED', 'Ask CentrePass is not available.', 404);
  }
  const started = performance.now();
  let question = '';
  let parseResult: ParseResult | null = null;
  try {
    const body = await readQuestion(request);
    if (body instanceof NextResponse) return body;
    question = body.question;
    const policyError = inputPolicyError(question);
    if (policyError) {
      return errorResponse('UNSUPPORTED_QUESTION', policyError, 400);
    }
    const keyHash = rateLimitKey(clientIdentifier(request));
    const rate = await checkDurableRateLimit(keyHash);
    const rateHeaders = { 'X-RateLimit-Remaining': String(rate.remaining) };
    if (!rate.allowed) {
      return errorResponse(
        'RATE_LIMITED',
        'Too many statistical queries. Try again shortly.',
        429,
        true,
        { ...rateHeaders, 'Retry-After': String(rate.retryAfterSeconds) },
      );
    }

    const context = await loadParserContext();
    const parsed = parseStatQuestion(question, context);
    parseResult = parsed;
    if (parsed.status === 'NEEDS_CLARIFICATION') {
      const latencyMs = Math.round(performance.now() - started);
      await writeTelemetryWithoutFailingRequest({ question, parseResult: parsed, resultStatus: parsed.status, resultCount: 0, latencyMs });
      return jsonResponse({ status: parsed.status, question, clarification: { reason: parsed.reason, question: parsed.question, options: parsed.options }, audit: { parserVersion: parsed.parserVersion, latencyMs, cache: 'MISS' } }, 200, rateHeaders);
    }
    if (parsed.status === 'UNSUPPORTED') {
      const latencyMs = Math.round(performance.now() - started);
      await writeTelemetryWithoutFailingRequest({ question, parseResult: parsed, resultStatus: parsed.status, resultCount: 0, latencyMs, errorCode: parsed.code });
      return jsonResponse({ status: parsed.status, question, error: { code: parsed.code, message: parsed.message, retryable: false }, audit: { parserVersion: parsed.parserVersion, latencyMs, cache: 'MISS' } }, 400, rateHeaders);
    }

    const revision = await analyticsRevision();
    const key = cacheKey(parsed.spec, revision);
    const cached = getCachedResult<Awaited<ReturnType<typeof executeQuerySpec>>>(key);
    const executed = cached ?? await withStatQueryTimeout(executeQuerySpec(parsed.spec), STAT_QUERY_LIMITS.timeoutMs);
    if (!cached) setCachedResult(key, executed);
    const latencyMs = Math.round(performance.now() - started);
    await writeTelemetryWithoutFailingRequest({ question, parseResult: parsed, resultStatus: 'READY', resultCount: resultCount(executed.result), latencyMs });
    return jsonResponse({
      status: 'READY', question, interpretation: parsed.interpretation, spec: parsed.spec,
      answer: executed.answer, result: executed.result,
      audit: { parserVersion: parsed.parserVersion, latencyMs, cache: cached ? 'HIT' : 'MISS', asOf: executed.asOf },
    }, 200, rateHeaders);
  } catch (error) {
    const timeout = error instanceof Error && error.message === 'STAT_QUERY_TIMEOUT';
    if (parseResult) {
      await writeTelemetryWithoutFailingRequest({
        question,
        parseResult,
        resultStatus: timeout ? 'QUERY_TIMEOUT' : 'QUERY_UNAVAILABLE',
        resultCount: 0,
        latencyMs: Math.round(performance.now() - started),
        errorCode: timeout ? 'QUERY_TIMEOUT' : 'QUERY_UNAVAILABLE',
      });
    }
    return errorResponse(
      timeout ? 'QUERY_TIMEOUT' : 'QUERY_UNAVAILABLE',
      timeout ? 'The statistical query took too long.' : 'Statistical search is temporarily unavailable.',
      timeout ? 504 : 503,
      true,
    );
  }
}
