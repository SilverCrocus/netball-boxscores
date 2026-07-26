#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SMOKE_VERSION = 'centrepass-production-smoke.v1';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRIES = 2;
const EXPECTED_MAX_ACTIVE_POLL_MS = 180_000;
export const MAX_RESPONSE_BODY_BYTES = 1_048_576;

export interface ProductionSmokeOptions {
  baseUrl: string;
  expectedCommit: string;
  phase: 'baseline' | 'published';
  outputDirectory: string;
  timeoutMs?: number;
  retries?: number;
}

interface RequestEvidence {
  status: number | null;
  attempts: number;
  durationMs: number;
  contentType: string | null;
  finalUrl: string | null;
  location: string | null;
  bodySha256: string | null;
}

export interface SmokeCheckEvidence {
  name: string;
  method: 'GET';
  path: string;
  expected: string;
  passed: boolean;
  observed: string;
  request: RequestEvidence;
  error: string | null;
}

export interface ProductionSmokeEvidence {
  schemaVersion: 1;
  toolVersion: string;
  startedAt: string;
  completedAt: string;
  baseUrl: string;
  expectedCommit: string;
  phase: 'baseline' | 'published';
  summary: {
    passed: boolean;
    passedChecks: number;
    failedChecks: number;
    totalChecks: number;
  };
  checks: SmokeCheckEvidence[];
}

interface HttpResult {
  response: Response;
  body: string;
  attempts: number;
  durationMs: number;
  finalUrl: string;
  location: string | null;
}

interface CheckContext {
  baseUrl: URL;
  expectedCommit: string;
  phase: 'baseline' | 'published';
  timeoutMs: number;
  retries: number;
  fetchImpl: typeof fetch;
}

interface MatchesPayload {
  groups?: Array<{
    matches?: Array<{
      id?: string;
      competitionId?: string;
      scoreAvailable?: boolean;
    }>;
  }>;
}

class HttpRequestFailure extends Error {
  readonly attempts: number;
  readonly durationMs: number;
  readonly status: number | null;
  readonly contentType: string | null;
  readonly finalUrl: string | null;
  readonly location: string | null;

  constructor(
    message: string,
    attempts: number,
    durationMs: number,
    metadata: Partial<Pick<HttpRequestFailure, 'status' | 'contentType' | 'finalUrl' | 'location'>> = {},
  ) {
    super(message);
    this.name = 'HttpRequestFailure';
    this.attempts = attempts;
    this.durationMs = durationMs;
    this.status = metadata.status ?? null;
    this.contentType = metadata.contentType ?? null;
    this.finalUrl = metadata.finalUrl ?? null;
    this.location = metadata.location ?? null;
  }
}

class UnsafeHttpResponse extends Error {}

function usage(): never {
  throw new Error(
    'Usage: npm run smoke:production -- --base-url https://www.centrepass.io '
      + '--expected-commit <FULL_GIT_SHA> --phase <baseline|published> '
      + '--output-dir <RELEASE_EVIDENCE_DIR> '
      + '[--timeout-ms 8000] [--retries 2]',
  );
}

function boundedInteger(
  value: string | undefined,
  label: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

export function parseProductionSmokeArguments(argv: string[]): ProductionSmokeOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) usage();
    if (values.has(key)) throw new Error(`Duplicate argument: ${key}`);
    values.set(key, value);
  }

  const allowed = new Set([
    '--base-url',
    '--expected-commit',
    '--phase',
    '--output-dir',
    '--timeout-ms',
    '--retries',
  ]);
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new Error(`Unknown argument: ${key}`);
  }

  const rawBaseUrl = values.get('--base-url');
  const expectedCommit = values.get('--expected-commit');
  const outputDirectory = values.get('--output-dir');
  const phase = values.get('--phase');
  if (!rawBaseUrl || !expectedCommit || !outputDirectory || !phase) usage();
  if (phase !== 'baseline' && phase !== 'published') {
    throw new Error('--phase must be baseline or published');
  }
  if (!/^[a-f0-9]{40}$/i.test(expectedCommit)) {
    throw new Error('--expected-commit must be the full 40-character Git SHA');
  }

  const baseUrl = new URL(rawBaseUrl);
  if (baseUrl.protocol !== 'https:') {
    throw new Error('--base-url must use HTTPS');
  }
  if (baseUrl.username || baseUrl.password) {
    throw new Error('--base-url must not contain credentials');
  }
  baseUrl.pathname = '/';
  baseUrl.search = '';
  baseUrl.hash = '';

  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ''),
    expectedCommit: expectedCommit.toLowerCase(),
    phase,
    outputDirectory: path.resolve(outputDirectory),
    timeoutMs: boundedInteger(values.get('--timeout-ms'), '--timeout-ms', DEFAULT_TIMEOUT_MS, 1, 60_000),
    retries: boundedInteger(values.get('--retries'), '--retries', DEFAULT_RETRIES, 0, 10),
  };
}

function safeUrl(value: URL): string {
  const safe = `${value.origin}${value.pathname}`;
  if (safe.length > 1_024 || /[\u0000-\u001f\u007f]/.test(safe)) {
    throw new UnsafeHttpResponse('response URL is not safe to retain');
  }
  return safe;
}

function safeContentType(value: string | null): string | null {
  if (!value) return null;
  const mime = value.split(';', 1)[0]!.trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime) ? mime : null;
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/\b(?:https?|postgres(?:ql)?):\/\/\S+/gi, '[redacted-url]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300) || 'request failed';
}

function responseMetadata(response: Response, requestedUrl: URL, baseUrl: URL): {
  finalUrl: string;
  location: string | null;
} {
  let final: URL;
  try {
    final = response.url ? new URL(response.url) : requestedUrl;
  } catch {
    throw new UnsafeHttpResponse('response final URL is invalid');
  }
  if (final.origin !== baseUrl.origin) throw new UnsafeHttpResponse('response followed a cross-origin redirect');
  const rawLocation = response.headers.get('location');
  let location: string | null = null;
  if (rawLocation) {
    let resolved: URL;
    try {
      resolved = new URL(rawLocation, final);
    } catch {
      throw new UnsafeHttpResponse('response redirect URL is invalid');
    }
    if (resolved.origin !== baseUrl.origin) throw new UnsafeHttpResponse('response contains a cross-origin redirect');
    location = safeUrl(resolved);
  }
  return { finalUrl: safeUrl(final), location };
}

async function boundedResponseBody(response: Response): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new UnsafeHttpResponse('response has an invalid Content-Length');
    }
    if (declaredLength > MAX_RESPONSE_BODY_BYTES) {
      throw new UnsafeHttpResponse(`response body exceeds ${MAX_RESPONSE_BODY_BYTES} bytes`);
    }
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BODY_BYTES) {
        await reader.cancel();
        throw new UnsafeHttpResponse(`response body exceeds ${MAX_RESPONSE_BODY_BYTES} bytes`);
      }
      body += decoder.decode(next.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function requestEvidence(result?: HttpResult, failure?: unknown): RequestEvidence {
  if (!result) {
    return {
      status: failure instanceof HttpRequestFailure ? failure.status : null,
      attempts: failure instanceof HttpRequestFailure ? failure.attempts : 0,
      durationMs: failure instanceof HttpRequestFailure ? failure.durationMs : 0,
      contentType: failure instanceof HttpRequestFailure ? safeContentType(failure.contentType) : null,
      finalUrl: failure instanceof HttpRequestFailure ? failure.finalUrl : null,
      location: failure instanceof HttpRequestFailure ? failure.location : null,
      bodySha256: null,
    };
  }

  return {
    status: result.response.status,
    attempts: result.attempts,
    durationMs: result.durationMs,
    contentType: safeContentType(result.response.headers.get('content-type')),
    finalUrl: result.finalUrl,
    location: result.location,
    bodySha256: createHash('sha256').update(result.body).digest('hex'),
  };
}

async function getWithRetry(
  context: CheckContext,
  requestPath: string,
  redirect: RequestRedirect = 'follow',
): Promise<HttpResult> {
  const url = new URL(requestPath, context.baseUrl);
  const startedAt = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= context.retries + 1; attempt += 1) {
    let response: Response | undefined;
    let metadata: { finalUrl: string; location: string | null } | undefined;
    try {
      response = await context.fetchImpl(url, {
        method: 'GET',
        redirect,
        headers: {
          Accept: 'text/html,application/json;q=0.9',
          'User-Agent': `${SMOKE_VERSION} release-verification`,
        },
        signal: AbortSignal.timeout(context.timeoutMs),
      });
      metadata = { finalUrl: safeUrl(url), location: null };
      metadata = responseMetadata(response, url, context.baseUrl);
      const body = await boundedResponseBody(response);
      if (response.status < 500 || attempt > context.retries) {
        return {
          response,
          body,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
          ...metadata,
        };
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (error instanceof UnsafeHttpResponse || attempt > context.retries) {
        const message = safeErrorMessage(error);
        throw new HttpRequestFailure(message, attempt, Date.now() - startedAt, {
          status: response?.status,
          contentType: response?.headers.get('content-type'),
          finalUrl: metadata?.finalUrl,
          location: metadata?.location,
        });
      }
    }
  }

  const message = safeErrorMessage(lastError);
  throw new HttpRequestFailure(message, context.retries + 1, Date.now() - startedAt);
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error('response body is not valid JSON');
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('response body is not a JSON object');
  }
  return value as Record<string, unknown>;
}

function isoTimestamp(value: unknown): boolean {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

async function check(
  context: CheckContext,
  input: {
    name: string;
    path: string;
    expected: string;
    redirect?: RequestRedirect;
    assert: (result: HttpResult) => string;
  },
): Promise<SmokeCheckEvidence> {
  let result: HttpResult | undefined;
  try {
    result = await getWithRetry(context, input.path, input.redirect);
    const observed = input.assert(result);
    return {
      name: input.name,
      method: 'GET',
      path: input.path,
      expected: input.expected,
      passed: true,
      observed,
      request: requestEvidence(result),
      error: null,
    };
  } catch (error) {
    return {
      name: input.name,
      method: 'GET',
      path: input.path,
      expected: input.expected,
      passed: false,
      observed: result ? `HTTP ${result.response.status}` : 'request failed',
      request: requestEvidence(result, error),
      error: safeErrorMessage(error),
    };
  }
}

function expectHtml(result: HttpResult, markers: RegExp[]): string {
  if (result.response.status !== 200) throw new Error(`expected HTTP 200, received ${result.response.status}`);
  const contentType = result.response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('text/html')) {
    throw new Error(`expected text/html, received ${contentType || 'no content type'}`);
  }
  for (const marker of markers) {
    if (!marker.test(result.body)) throw new Error(`missing HTML marker ${marker}`);
  }
  return `HTTP 200; markers ${markers.map((marker) => marker.source).join(', ')}`;
}

function expectNotFound(result: HttpResult): string {
  if (result.response.status !== 404) throw new Error(`expected HTTP 404, received ${result.response.status}`);
  return 'HTTP 404; feature fails closed';
}

function firstSsnMatch(payload: MatchesPayload): { id: string; competitionId: string } {
  const matches = payload.groups?.flatMap((group) => group.matches ?? []) ?? [];
  const match = matches.find((candidate) => (
    typeof candidate.id === 'string'
    && typeof candidate.competitionId === 'string'
    && candidate.scoreAvailable === true
  ));
  if (!match?.id || !match.competitionId
    || !/^[A-Za-z0-9_-]{1,100}$/.test(match.id)
    || !/^[A-Za-z0-9_-]{1,100}$/.test(match.competitionId)) {
    throw new Error('no public score-bearing SSN match was returned');
  }
  return { id: match.id, competitionId: match.competitionId };
}

export async function executeProductionSmoke(
  options: Omit<ProductionSmokeOptions, 'outputDirectory'>,
  fetchImpl: typeof fetch = fetch,
): Promise<ProductionSmokeEvidence> {
  const startedAt = new Date();
  const baseUrl = new URL(options.baseUrl);
  const context: CheckContext = {
    baseUrl,
    expectedCommit: options.expectedCommit.toLowerCase(),
    phase: options.phase,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retries: options.retries ?? DEFAULT_RETRIES,
    fetchImpl,
  };
  const checks: SmokeCheckEvidence[] = [];

  checks.push(await check(context, {
    name: 'Liveness and deployed commit',
    path: '/api/health',
    expected: `HTTP 200; status=ok; type=liveness; release.commit=${context.expectedCommit}`,
    assert(result) {
      if (result.response.status !== 200) throw new Error(`expected HTTP 200, received ${result.response.status}`);
      const body = objectValue(parseJson(result.body));
      const release = objectValue(body.release);
      if (body.status !== 'ok' || body.type !== 'liveness' || !isoTimestamp(body.timestamp)) {
        throw new Error('health contract is invalid');
      }
      const deployedCommit = String(release.commit).toLowerCase();
      if (!/^[a-f0-9]{40}$/.test(deployedCommit)) throw new Error('deployed commit is invalid');
      if (deployedCommit !== context.expectedCommit) {
        throw new Error(`deployed commit ${deployedCommit} does not match expected commit`);
      }
      return `HTTP 200; commit ${String(release.commit)}; timestamp ${String(body.timestamp)}`;
    },
  }));

  checks.push(await check(context, {
    name: 'Readiness and scoped database boundaries',
    path: '/api/readiness',
    expected: context.phase === 'published'
      ? 'HTTP 200; status=ready; database/worker/analytics/statsOperations satisfy readiness; analytics and Ask enabled'
      : 'HTTP 200; status=ready; database/worker satisfy readiness; analytics and Ask disabled',
    assert(result) {
      if (result.response.status !== 200) throw new Error(`expected HTTP 200, received ${result.response.status}`);
      const body = objectValue(parseJson(result.body));
      const allChecks = objectValue(body.checks);
      const database = objectValue(allChecks.database);
      const worker = objectValue(allChecks.worker);
      const analytics = objectValue(allChecks.analytics);
      const operations = objectValue(allChecks.statsOperations);
      if (body.status !== 'ready' || body.type !== 'readiness' || !isoTimestamp(body.timestamp)) {
        throw new Error('readiness contract is invalid');
      }
      if (database.ok !== true) {
        throw new Error('database does not satisfy readiness');
      }
      if (worker.ok !== true
        || worker.enabled !== true
        || worker.required !== true
        || worker.state !== 'healthy'
        || worker.satisfiesReadiness !== true
        || worker.isHealthy !== true) {
        throw new Error('worker is not enabled, required, healthy, and readiness-satisfying');
      }
      if (!['success', 'empty'].includes(String(worker.lastPollStatus))) {
        throw new Error('worker lastPollStatus is not success or empty');
      }
      if (!Number.isSafeInteger(worker.currentIntervalMs)
        || Number(worker.currentIntervalMs) <= 0
        || Number(worker.currentIntervalMs) > Number.MAX_SAFE_INTEGER / 2) {
        throw new Error('worker currentIntervalMs is not a positive integer');
      }
      if (!isoTimestamp(worker.lastPollAt)) {
        throw new Error('worker lastPollAt is not a valid timestamp');
      }
      const readinessAt = Date.parse(String(body.timestamp));
      const lastPollAt = Date.parse(String(worker.lastPollAt));
      const freshnessMs = Number(worker.currentIntervalMs) * 2;
      if (typeof worker.pollInProgress !== 'boolean') {
        throw new Error('worker pollInProgress is not a boolean');
      }
      if (worker.maxActivePollMs !== EXPECTED_MAX_ACTIVE_POLL_MS) {
        throw new Error('worker maxActivePollMs does not match the release policy');
      }
      if (worker.pollInProgress) {
        if (!isoTimestamp(worker.pollStartedAt)) {
          throw new Error('worker pollStartedAt is not a valid timestamp');
        }
        if (!Number.isSafeInteger(worker.pollElapsedMs) || Number(worker.pollElapsedMs) < 0) {
          throw new Error('worker pollElapsedMs is not a non-negative integer');
        }
        const pollStartedAt = Date.parse(String(worker.pollStartedAt));
        const activePollIsValid =
          lastPollAt <= pollStartedAt &&
          pollStartedAt < lastPollAt + freshnessMs &&
          pollStartedAt <= readinessAt &&
          readinessAt - pollStartedAt < EXPECTED_MAX_ACTIVE_POLL_MS &&
          Number(worker.pollElapsedMs) < EXPECTED_MAX_ACTIVE_POLL_MS;
        if (!activePollIsValid) {
          throw new Error('worker active poll is stale or invalid');
        }
      } else {
        if (worker.pollStartedAt !== null || worker.pollElapsedMs !== null) {
          throw new Error('worker inactive poll state is inconsistent');
        }
        if (lastPollAt > readinessAt || readinessAt - lastPollAt >= freshnessMs) {
          throw new Error('worker lastPollAt is stale or later than readiness time');
        }
      }
      if (context.phase === 'published') {
        if (analytics.enabled !== true || analytics.state !== 'healthy' || analytics.satisfiesReadiness !== true) {
          throw new Error('analytics is not enabled and healthy');
        }
        if (operations.enabled !== true || operations.state !== 'healthy' || operations.satisfiesReadiness !== true) {
          throw new Error('Ask CentrePass operations boundary is not enabled and healthy');
        }
        return `HTTP 200; database ok; worker ${String(worker.state)}; analytics healthy; operations healthy`;
      }
      if (analytics.enabled !== false || analytics.state !== 'disabled' || analytics.satisfiesReadiness !== true) {
        throw new Error('analytics is not disabled and readiness-satisfying during baseline smoke');
      }
      if (operations.enabled !== false || operations.state !== 'disabled' || operations.satisfiesReadiness !== true) {
        throw new Error('Ask CentrePass is not disabled and readiness-satisfying during baseline smoke');
      }
      return `HTTP 200; database ok; worker ${String(worker.state)}; analytics disabled; operations disabled`;
    },
  }));

  checks.push(await check(context, {
    name: 'SSN public home',
    path: '/',
    expected: 'HTTP 200 HTML containing CentrePass and no database-unavailable state',
    assert(result) {
      const observed = expectHtml(result, [/CentrePass/i]);
      if (/Scores temporarily unavailable/i.test(result.body)) {
        throw new Error('home page is showing the database-unavailable state');
      }
      return observed;
    },
  }));

  let ssnMatch: { id: string; competitionId: string } | null = null;
  checks.push(await check(context, {
    name: 'SSN completed-result API',
    path: '/api/matches?season=2026',
    expected: 'HTTP 200 JSON with at least one public score-bearing SSN 2026 result',
    assert(result) {
      if (result.response.status !== 200) throw new Error(`expected HTTP 200, received ${result.response.status}`);
      const payload = objectValue(parseJson(result.body)) as MatchesPayload;
      ssnMatch = firstSsnMatch(payload);
      return `HTTP 200; public match ${ssnMatch.id}; competition ${ssnMatch.competitionId}`;
    },
  }));

  checks.push(await check(context, {
    name: context.phase === 'published' ? 'Published Glasgow 2026 competition' : 'Unpublished Glasgow fail-closed boundary',
    path: '/competitions/commonwealth-games-netball/glasgow-2026',
    expected: context.phase === 'published'
      ? 'HTTP 200 HTML containing Glasgow 2026 and tournament schedule context'
      : 'HTTP 404 while Glasgow is not published',
    assert: context.phase === 'published'
      ? (result) => expectHtml(result, [/Glasgow 2026/i, /Pool A|Australia|England/i])
      : expectNotFound,
  }));

  checks.push(await check(context, {
    name: 'Rankings surface',
    path: '/rankings',
    expected: context.phase === 'published' ? 'HTTP 200 HTML containing CentrePass Rankings' : 'HTTP 404 while analytics is disabled',
    assert: context.phase === 'published' ? (result) => expectHtml(result, [/CentrePass Rankings/i]) : expectNotFound,
  }));

  checks.push(await check(context, {
    name: 'Records surface',
    path: '/records',
    expected: context.phase === 'published' ? 'HTTP 200 HTML containing CentrePass Records' : 'HTTP 404 while analytics is disabled',
    assert: context.phase === 'published' ? (result) => expectHtml(result, [/CentrePass Records/i]) : expectNotFound,
  }));

  checks.push(await check(context, {
    name: 'Player comparison surface',
    path: '/compare/players',
    expected: context.phase === 'published' ? 'HTTP 200 HTML containing Compare Players' : 'HTTP 404 while analytics is disabled',
    assert: context.phase === 'published' ? (result) => expectHtml(result, [/Compare Players/i]) : expectNotFound,
  }));

  checks.push(await check(context, {
    name: 'Ask CentrePass surface',
    path: '/explore',
    expected: context.phase === 'published' ? 'HTTP 200 HTML containing Ask CentrePass' : 'HTTP 404 while Ask CentrePass is disabled',
    assert: context.phase === 'published' ? (result) => expectHtml(result, [/Ask CentrePass/i]) : expectNotFound,
  }));

  // The discovery happens inside the assertion callback above. TypeScript does
  // not carry that callback assignment into control-flow narrowing here.
  const discoveredSsnMatch = ssnMatch as { id: string; competitionId: string } | null;
  if (discoveredSsnMatch) {
    const redirectPath = `/match/${encodeURIComponent(discoveredSsnMatch.id)}?edition=glasgow-2026`;
    checks.push(await check(context, {
      name: 'Canonical match-edition redirect',
      path: redirectPath,
      redirect: 'manual',
      expected: `HTTP 307/308 redirect to the same match with edition=${discoveredSsnMatch.competitionId}`,
      assert(result) {
        if (![307, 308].includes(result.response.status)) {
          throw new Error(`expected HTTP 307/308, received ${result.response.status}`);
        }
        const rawLocation = result.response.headers.get('location');
        if (!rawLocation) throw new Error('redirect has no Location header');
        const location = new URL(rawLocation, context.baseUrl);
        if (location.origin !== context.baseUrl.origin
          || location.pathname !== `/match/${encodeURIComponent(discoveredSsnMatch.id)}`) {
          throw new Error('redirected to an unexpected origin or path');
        }
        if (location.searchParams.get('edition') !== discoveredSsnMatch.competitionId) {
          throw new Error('redirected to an unexpected edition');
        }
        return `HTTP ${result.response.status}; owning edition redirect verified`;
      },
    }));
  } else {
    checks.push({
      name: 'Canonical match-edition redirect',
      method: 'GET',
      path: '/match/<DISCOVERED_SSN_MATCH>?edition=glasgow-2026',
      expected: 'HTTP 307/308 redirect to the owning SSN edition',
      passed: false,
      observed: 'not attempted',
      request: requestEvidence(),
      error: 'SSN match discovery failed',
    });
  }

  const failedChecks = checks.filter((candidate) => !candidate.passed).length;
  return {
    schemaVersion: 1,
    toolVersion: SMOKE_VERSION,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    baseUrl: baseUrl.toString().replace(/\/$/, ''),
    expectedCommit: context.expectedCommit,
    phase: context.phase,
    summary: {
      passed: failedChecks === 0,
      passedChecks: checks.length - failedChecks,
      failedChecks,
      totalChecks: checks.length,
    },
    checks,
  };
}

export function renderProductionSmokeMarkdown(evidence: ProductionSmokeEvidence): string {
  const rows = evidence.checks.map((check) => (
    `| ${check.passed ? 'PASS' : 'FAIL'} | ${check.name.replaceAll('|', '\\|')} | `
      + `${check.request.status ?? 'n/a'} | ${check.request.durationMs} | `
      + `${(check.error ?? check.observed).replaceAll('|', '\\|').replaceAll('\n', ' ')} |`
  ));
  return [
    '# CentrePass production smoke evidence',
    '',
    `- Tool: \`${evidence.toolVersion}\``,
    `- Started: ${evidence.startedAt}`,
    `- Completed: ${evidence.completedAt}`,
    `- Base URL: ${evidence.baseUrl}`,
    `- Expected commit: \`${evidence.expectedCommit}\``,
    `- Phase: \`${evidence.phase}\``,
    `- Result: **${evidence.summary.passed ? 'PASS' : 'FAIL'}** (${evidence.summary.passedChecks}/${evidence.summary.totalChecks})`,
    '',
    '| Result | Check | HTTP | Duration (ms) | Evidence |',
    '| --- | --- | ---: | ---: | --- |',
    ...rows,
    '',
    'The JSON sibling is the authoritative machine-readable evidence. This smoke is intentionally public and read-only: it does not sign in, create users, submit Ask CentrePass questions, mutate data, or publish Glasgow.',
    '',
  ].join('\n');
}

export async function writeProductionSmokeEvidence(
  evidence: ProductionSmokeEvidence,
  outputDirectory: string,
): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const linkDetails = await lstat(outputDirectory);
  let directoryDetails = await stat(outputDirectory);
  if (linkDetails.isSymbolicLink() || !directoryDetails.isDirectory()) {
    throw new Error('production smoke evidence path must be a real directory');
  }
  if (typeof process.getuid === 'function' && directoryDetails.uid !== process.getuid()) {
    throw new Error('production smoke evidence directory must be owned by the current user');
  }
  if ((directoryDetails.mode & 0o777) !== 0o700) {
    await chmod(outputDirectory, 0o700);
    directoryDetails = await stat(outputDirectory);
  }
  if ((directoryDetails.mode & 0o777) !== 0o700) {
    throw new Error('production smoke evidence directory must have mode 0700');
  }
  const stamp = evidence.startedAt.replace(/[-:.]/g, '').replace('Z', 'Z');
  const prefix = path.join(outputDirectory, `production-smoke-${stamp}`);
  const jsonPath = `${prefix}.json`;
  const markdownPath = `${prefix}.md`;
  const writePrivateFile = async (filePath: string, contents: string): Promise<void> => {
    const file = await open(filePath, 'wx', 0o600);
    try {
      await file.chmod(0o600);
      await file.writeFile(contents, { encoding: 'utf8' });
    } finally {
      await file.close();
    }
  };
  await Promise.all([
    writePrivateFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`),
    writePrivateFile(markdownPath, renderProductionSmokeMarkdown(evidence)),
  ]);
  return { jsonPath, markdownPath };
}

async function main(): Promise<void> {
  const options = parseProductionSmokeArguments(process.argv.slice(2));
  const evidence = await executeProductionSmoke(options);
  const paths = await writeProductionSmokeEvidence(evidence, options.outputDirectory);
  console.log(JSON.stringify({
    status: evidence.summary.passed ? 'passed' : 'failed',
    summary: evidence.summary,
    evidence: paths,
  }, null, 2));
  if (!evidence.summary.passed) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
