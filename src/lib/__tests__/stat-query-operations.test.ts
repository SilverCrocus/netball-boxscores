import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const databaseMocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('@/lib/scoped-database-boundary', () => ({
  getVerifiedStatsOperationsDatabase: async () => ({
    $executeRaw: databaseMocks.executeRaw,
    $queryRaw: databaseMocks.queryRaw,
  }),
}));

import {
  cacheKey,
  questionHash,
  rateLimitKey,
  statsRateLimitSecretConfigured,
  withStatQueryTimeout,
  writeQueryTelemetry,
} from '@/lib/stat-query/operations';
import { QUERY_SPEC_VERSION, RULE_PARSER_VERSION } from '@/lib/stat-query/types';

describe('stat query privacy and caching primitives', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.executeRaw.mockResolvedValue(1);
    vi.stubEnv('STATS_RATE_LIMIT_SECRET', 'test-secret-that-is-longer-than-thirty-two-characters');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('hashes normalized questions without retaining their text', () => {
    const first = questionHash('  Grace Nweke GOALS? ');
    expect(first).toBe(questionHash('grace nweke goals'));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('grace');
  });

  it('uses a keyed HMAC rather than an unkeyed question digest', () => {
    const first = questionHash('Grace Nweke goals');
    vi.stubEnv('STATS_RATE_LIMIT_SECRET', 'a-different-secret-that-is-also-longer-than-thirty-two');
    expect(questionHash('Grace Nweke goals')).not.toBe(first);
  });

  it('rejects long example placeholders as deployment secrets', () => {
    vi.stubEnv('STATS_RATE_LIMIT_SECRET', 'generate-a-separate-secret-of-at-least-32-characters');
    expect(statsRateLimitSecretConfigured()).toBe(false);
  });

  it('rotates client rate-limit hashes daily', () => {
    const first = rateLimitKey('203.0.113.10', new Date('2026-07-16T00:00:00Z'));
    const next = rateLimitKey('203.0.113.10', new Date('2026-07-17T00:00:00Z'));
    expect(first).not.toBe(next);
    expect(first).not.toContain('203.0.113.10');
  });

  it('includes analytics revision in result-cache identity', () => {
    const spec = {
      version: QUERY_SPEC_VERSION, intent: 'LOOKUP' as const, subject: 'PLAYER' as const,
      entityIds: ['p1'], metrics: [{ id: 'goals', aggregation: 'TOTAL' as const }],
      filters: { editionId: 'e1', officialCompletedOnly: true as const, excludeSimulations: true as const },
      window: { type: 'EDITION' as const }, groupBy: 'NONE' as const, order: 'DESC' as const,
      minimumMinutes: 0, limit: 1,
    };
    expect(cacheKey(spec, 'revision-1')).not.toBe(cacheKey(spec, 'revision-2'));
  });

  it('enforces the application timeout even when a query promise remains pending', async () => {
    vi.useFakeTimers();
    const pending = new Promise<string>(() => undefined);
    const result = withStatQueryTimeout(pending, 2_000);
    const rejection = expect(result).rejects.toThrow('STAT_QUERY_TIMEOUT');

    await vi.advanceTimersByTimeAsync(2_000);

    await rejection;
  });

  it('executes void telemetry without asking Prisma to decode a result row', async () => {
    await expect(writeQueryTelemetry({
      question: 'Can CentrePass answer this preview-only question?',
      parseResult: {
        status: 'UNSUPPORTED',
        code: 'PREVIEW_ONLY',
        message: 'Preview-only telemetry regression input.',
        parserVersion: RULE_PARSER_VERSION,
      },
      resultStatus: 'UNSUPPORTED',
      resultCount: 0,
      latencyMs: 17,
      errorCode: 'PREVIEW_ONLY',
    })).resolves.toBeUndefined();

    expect(databaseMocks.queryRaw).not.toHaveBeenCalled();
    expect(databaseMocks.executeRaw).toHaveBeenCalledTimes(1);
    const statement = databaseMocks.executeRaw.mock.calls[0]?.[0] as {
      strings: string[];
      values: unknown[];
    };
    expect(statement.strings.join('?')).toContain(
      'SELECT analytics.write_stat_query_telemetry(',
    );
    expect(statement.strings.join('?')).toMatch(
      /\?::INTEGER,\s+\?::INTEGER,/,
    );
    expect(statement.values).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/),
      null,
      RULE_PARSER_VERSION,
      'UNSUPPORTED',
      0,
      17,
      'PREVIEW_ONLY',
    ]);
  });
});
