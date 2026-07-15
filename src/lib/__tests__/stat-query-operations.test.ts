import { describe, expect, it } from 'vitest';
import { cacheKey, questionHash, rateLimitKey } from '@/lib/stat-query/operations';
import { QUERY_SPEC_VERSION } from '@/lib/stat-query/types';

describe('stat query privacy and caching primitives', () => {
  it('hashes normalized questions without retaining their text', () => {
    const first = questionHash('  Grace Nweke GOALS? ');
    expect(first).toBe(questionHash('grace nweke goals'));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('grace');
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
});
