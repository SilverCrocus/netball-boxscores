import { NextResponse } from 'next/server';
import { executeQuerySpec } from '@/lib/stat-query/executor';
import { loadParserContext } from '@/lib/stat-query/context';
import { analyticsRevision, cacheKey, checkDurableRateLimit, getCachedResult, rateLimitKey, setCachedResult, withStatQueryTimeout, writeQueryTelemetry } from '@/lib/stat-query/operations';
import { parseStatQuestion } from '@/lib/stat-query/parser';
import { STAT_QUERY_LIMITS } from '@/lib/stat-query/policy';
import type { StatQueryResponse } from '@/lib/stat-query/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function clientIdentifier(request: Request): string {
  return request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown';
}

function resultCount(result: unknown): number {
  if (!result || typeof result !== 'object') return 0;
  const value = result as { entries?: unknown[]; metrics?: unknown[]; value?: unknown; entry?: unknown };
  if (Array.isArray(value.entries)) return value.entries.length;
  if (Array.isArray(value.metrics)) return value.metrics.length;
  return value.value || value.entry ? 1 : 0;
}

export async function POST(request: Request): Promise<NextResponse<StatQueryResponse | { error: { code: string; message: string; retryable: boolean } }>> {
  const started = performance.now();
  let question = '';
  let keyHash = '';
  try {
    const body = await request.json() as { question?: unknown };
    if (typeof body.question !== 'string') return NextResponse.json({ error: { code: 'INVALID_BODY', message: 'question must be a string', retryable: false } }, { status: 400 });
    question = body.question;
    keyHash = rateLimitKey(clientIdentifier(request));
    const rate = await checkDurableRateLimit(keyHash);
    if (!rate.allowed) return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many statistical queries. Try again shortly.', retryable: true } }, { status: 429, headers: { 'Retry-After': '60' } });

    const context = await loadParserContext();
    const parsed = parseStatQuestion(question, context);
    if (parsed.status === 'NEEDS_CLARIFICATION') {
      const latencyMs = Math.round(performance.now() - started);
      await writeQueryTelemetry({ question, parseResult: parsed, resultStatus: parsed.status, resultCount: 0, latencyMs });
      return NextResponse.json({ status: parsed.status, question, clarification: { reason: parsed.reason, question: parsed.question, options: parsed.options }, audit: { parserVersion: parsed.parserVersion, latencyMs, cache: 'MISS' } });
    }
    if (parsed.status === 'UNSUPPORTED') {
      const latencyMs = Math.round(performance.now() - started);
      await writeQueryTelemetry({ question, parseResult: parsed, resultStatus: parsed.status, resultCount: 0, latencyMs, errorCode: parsed.code });
      return NextResponse.json({ status: parsed.status, question, error: { code: parsed.code, message: parsed.message, retryable: false }, audit: { parserVersion: parsed.parserVersion, latencyMs, cache: 'MISS' } }, { status: 400 });
    }

    const revision = await analyticsRevision();
    const key = cacheKey(parsed.spec, revision);
    const cached = getCachedResult<Awaited<ReturnType<typeof executeQuerySpec>>>(key);
    const executed = cached ?? await withStatQueryTimeout(executeQuerySpec(parsed.spec), STAT_QUERY_LIMITS.timeoutMs);
    if (!cached) setCachedResult(key, executed);
    const latencyMs = Math.round(performance.now() - started);
    await writeQueryTelemetry({ question, parseResult: parsed, resultStatus: 'READY', resultCount: resultCount(executed.result), latencyMs });
    return NextResponse.json({
      status: 'READY', question, interpretation: parsed.interpretation, spec: parsed.spec,
      answer: executed.answer, result: executed.result,
      audit: { parserVersion: parsed.parserVersion, latencyMs, cache: cached ? 'HIT' : 'MISS', asOf: executed.asOf },
    });
  } catch (error) {
    const timeout = error instanceof Error && error.message === 'STAT_QUERY_TIMEOUT';
    return NextResponse.json({ error: { code: timeout ? 'QUERY_TIMEOUT' : 'QUERY_UNAVAILABLE', message: timeout ? 'The statistical query took too long.' : 'Statistical search is temporarily unavailable.', retryable: true } }, { status: timeout ? 504 : 503 });
  }
}
