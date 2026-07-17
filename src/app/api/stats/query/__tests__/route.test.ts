import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadContext: vi.fn(), parse: vi.fn(), execute: vi.fn(), revision: vi.fn(),
  cacheKey: vi.fn(), rate: vi.fn(), cached: vi.fn(), rateKey: vi.fn(),
  setCached: vi.fn(), timeout: vi.fn(), telemetry: vi.fn(),
}));

vi.mock('@/lib/stat-query/context', () => ({ loadParserContext: mocks.loadContext }));
vi.mock('@/lib/stat-query/parser', () => ({ parseStatQuestion: mocks.parse }));
vi.mock('@/lib/stat-query/executor', () => ({ executeQuerySpec: mocks.execute }));
vi.mock('@/lib/stat-query/operations', () => ({
  analyticsRevision: mocks.revision, cacheKey: mocks.cacheKey,
  checkDurableRateLimit: mocks.rate, getCachedResult: mocks.cached,
  rateLimitKey: mocks.rateKey, setCachedResult: mocks.setCached,
  withStatQueryTimeout: mocks.timeout, writeQueryTelemetry: mocks.telemetry,
}));

import { POST } from '../route';

const spec = {
  version: 'query-spec.v1' as const, intent: 'LOOKUP' as const, subject: 'PLAYER' as const,
  entityIds: ['player-1'], metrics: [{ id: 'goals', aggregation: 'PER_GAME' as const }],
  filters: { editionId: 'edition-1', officialCompletedOnly: true as const, excludeSimulations: true as const },
  window: { type: 'EDITION' as const }, groupBy: 'NONE' as const, order: 'DESC' as const,
  minimumMinutes: 0, limit: 1,
};

function request(body: unknown) {
  return new Request('https://centrepass.test/api/stats/query', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/stats/query', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.rateKey.mockReturnValue('hashed-client');
    mocks.rate.mockResolvedValue({ allowed: true, remaining: 29, retryAfterSeconds: 42 });
    mocks.loadContext.mockResolvedValue({ entities: [], editions: [], defaultEditionId: 'edition-1' });
    mocks.revision.mockResolvedValue('revision-1');
    mocks.cacheKey.mockReturnValue('cache-key');
    mocks.cached.mockReturnValue(null);
    mocks.timeout.mockImplementation((operation: Promise<unknown>) => operation);
    mocks.telemetry.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails closed before reading the body when the Ask kill switch is off', async () => {
    vi.stubEnv('ANALYTICS_FEATURES_ENABLED', 'false');
    vi.stubEnv('ASK_CENTREPASS_ENABLED', 'false');

    const response = await POST(request({ question: 'Grace Nweke goals' }));

    expect(response.status).toBe(404);
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('validates the body before querying', async () => {
    const response = await POST(request({ question: 42 }));
    expect(response.status).toBe(400);
    expect(mocks.rate).not.toHaveBeenCalled();
  });

  it('uses the durable rate-limit decision', async () => {
    mocks.rate.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 42 });
    const response = await POST(request({ question: 'Grace Nweke goals' }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(response.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('rejects non-JSON, cross-origin, oversized, and extra-property bodies before database work', async () => {
    const nonJson = new Request('https://centrepass.test/api/stats/query', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hello',
    });
    expect((await POST(nonJson)).status).toBe(415);

    const crossOrigin = new Request('https://centrepass.test/api/stats/query', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.test' }, body: '{"question":"goals"}',
    });
    expect((await POST(crossOrigin)).status).toBe(403);

    const spoofedForwardedOrigin = new Request('https://centrepass.test/api/stats/query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://attacker.test',
        'x-forwarded-host': 'attacker.test',
        'x-forwarded-proto': 'https',
      },
      body: '{"question":"goals"}',
    });
    expect((await POST(spoofedForwardedOrigin)).status).toBe(403);

    const oversized = new Request('https://centrepass.test/api/stats/query', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'a'.repeat(1_100) }),
    });
    expect((await POST(oversized)).status).toBe(413);

    expect((await POST(request({ question: 'Grace goals', sql: 'select *' }))).status).toBe(400);
    expect(mocks.rate).not.toHaveBeenCalled();
  });

  it('rejects policy violations before consuming a durable rate-limit slot', async () => {
    const response = await POST(request({ question: 'drop the public matches table' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'UNSUPPORTED_QUESTION' },
    });
    expect(mocks.rate).not.toHaveBeenCalled();
  });

  it('returns clarification without executing a query', async () => {
    mocks.parse.mockReturnValue({ status: 'NEEDS_CLARIFICATION', reason: 'METRIC_MISSING', question: 'Which statistic?', options: [{ id: 'goals', label: 'Goals' }], parserVersion: 'centrepass-rules.v1' });
    const response = await POST(request({ question: 'What did Grace average?' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'NEEDS_CLARIFICATION', clarification: { reason: 'METRIC_MISSING' } });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.telemetry).toHaveBeenCalled();
  });

  it('returns a deterministic answer and auditable normalized spec', async () => {
    mocks.parse.mockReturnValue({ status: 'READY', spec, interpretation: 'lookup: Grace · Goals', parserVersion: 'centrepass-rules.v1' });
    mocks.execute.mockResolvedValue({ answer: 'Grace averaged 50.0 goals.', result: { value: 50 }, asOf: '2026-07-04T09:30:00.000Z' });
    const response = await POST(request({ question: 'Grace goals average' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'READY', answer: 'Grace averaged 50.0 goals.', spec,
      audit: { parserVersion: 'centrepass-rules.v1', cache: 'MISS', asOf: '2026-07-04T09:30:00.000Z' },
    });
    expect(mocks.setCached).toHaveBeenCalled();
    expect(mocks.telemetry).toHaveBeenCalledWith(expect.objectContaining({ question: 'Grace goals average' }));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('does not fail a successful answer when privacy telemetry is unavailable', async () => {
    mocks.parse.mockReturnValue({ status: 'READY', spec, interpretation: 'lookup: Grace · Goals', parserVersion: 'centrepass-rules.v1' });
    mocks.execute.mockResolvedValue({ answer: 'Grace recorded 50 goals.', result: { value: 50 }, asOf: '2026-07-04T09:30:00.000Z' });
    mocks.telemetry.mockRejectedValue(new Error('operations unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await POST(request({ question: 'Grace goals total' }));

    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalledWith('[Ask CentrePass] telemetry write failed');
    warn.mockRestore();
  });

  it('returns a retryable timeout and records only bounded telemetry', async () => {
    mocks.parse.mockReturnValue({ status: 'READY', spec, interpretation: 'lookup: Grace · Goals', parserVersion: 'centrepass-rules.v1' });
    mocks.timeout.mockRejectedValue(new Error('STAT_QUERY_TIMEOUT'));

    const response = await POST(request({ question: 'Grace goals total' }));

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'QUERY_TIMEOUT', retryable: true },
    });
    expect(mocks.telemetry).toHaveBeenCalledWith(expect.objectContaining({
      resultStatus: 'QUERY_TIMEOUT',
      resultCount: 0,
      errorCode: 'QUERY_TIMEOUT',
    }));
  });
});
