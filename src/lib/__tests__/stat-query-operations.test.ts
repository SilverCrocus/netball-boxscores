import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheKey,
  questionHash,
  rateLimitKey,
  statsRateLimitSecretConfigured,
  withStatQueryTimeout,
} from '@/lib/stat-query/operations';
import { QUERY_SPEC_VERSION } from '@/lib/stat-query/types';

describe('stat query privacy and caching primitives', () => {
  beforeEach(() => {
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
});
