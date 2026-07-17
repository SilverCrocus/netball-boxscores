#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SMOKE_VERSION = 'centrepass-production-smoke.v1';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRIES = 2;
const MAX_EVIDENCE_BODY_SAMPLE = 500;

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
  location: string | null;
  bodySha256: string | null;
  bodySample: string | null;
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

  constructor(message: string, attempts: number, durationMs: number) {
    super(message);
    this.name = 'HttpRequestFailure';
    this.attempts = attempts;
    this.durationMs = durationMs;
  }
}

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

function sampleBody(body: string): string | null {
  if (!body) return null;
  return body
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_EVIDENCE_BODY_SAMPLE) || null;
}

function requestEvidence(result?: HttpResult, failure?: unknown): RequestEvidence {
  if (!result) {
    return {
      status: null,
      attempts: failure instanceof HttpRequestFailure ? failure.attempts : 0,
      durationMs: failure instanceof HttpRequestFailure ? failure.durationMs : 0,
      contentType: null,
      location: null,
      bodySha256: null,
      bodySample: null,
    };
  }

  return {
    status: result.response.status,
    attempts: result.attempts,
    durationMs: result.durationMs,
    contentType: result.response.headers.get('content-type'),
    location: result.response.headers.get('location'),
    bodySha256: createHash('sha256').update(result.body).digest('hex'),
    bodySample: sampleBody(result.body),
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
    try {
      const response = await context.fetchImpl(url, {
        method: 'GET',
        redirect,
        headers: {
          Accept: 'text/html,application/json;q=0.9',
          'User-Agent': `${SMOKE_VERSION} release-verification`,
        },
        signal: AbortSignal.timeout(context.timeoutMs),
      });
      const body = await response.text();
      if (response.status < 500 || attempt > context.retries) {
        return {
          response,
          body,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
        };
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt > context.retries) {
        const message = error instanceof Error ? error.message : String(error);
        throw new HttpRequestFailure(message, attempt, Date.now() - startedAt);
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Request failed';
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
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
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
      error: error instanceof Error ? error.message : String(error),
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
  if (!match?.id || !match.competitionId) {
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
      if (String(release.commit).toLowerCase() !== context.expectedCommit) {
        throw new Error(`deployed commit ${String(release.commit)} does not match expected commit`);
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
        || worker.satisfiesReadiness !== true) {
        throw new Error('worker is not enabled, required, healthy, and readiness-satisfying');
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
        if (location.pathname !== `/match/${encodeURIComponent(discoveredSsnMatch.id)}`) {
          throw new Error(`redirected to unexpected path ${location.pathname}`);
        }
        if (location.searchParams.get('edition') !== discoveredSsnMatch.competitionId) {
          throw new Error(`redirected to unexpected edition ${location.searchParams.get('edition')}`);
        }
        return `HTTP ${result.response.status}; ${location.pathname}${location.search}`;
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
  const stamp = evidence.startedAt.replace(/[-:.]/g, '').replace('Z', 'Z');
  const prefix = path.join(outputDirectory, `production-smoke-${stamp}`);
  const jsonPath = `${prefix}.json`;
  const markdownPath = `${prefix}.md`;
  const writePrivateFile = async (filePath: string, contents: string): Promise<void> => {
    const file = await open(filePath, 'wx', 0o600);
    try {
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
