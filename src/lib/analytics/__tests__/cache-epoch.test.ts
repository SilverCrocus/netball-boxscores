import { describe, expect, it, vi } from 'vitest';
import { buildAnalyticsSnapshotCacheKey } from '@/lib/analytics/cache-epoch';

describe('analytics snapshot cache keys', () => {
  it('is deterministic and changes when the epoch or request payload changes', () => {
    const input = {
      methodVersion: 'centrepass-player-ranking.v1',
      formulaVersion: 'goals.v1',
      request: {
        competitionId: 'edition-1',
        metricId: 'goals',
        aggregation: 'TOTAL',
        position: null,
        stageId: null,
        stageGroupId: null,
        lastN: null,
        from: null,
        to: null,
        minimumMinutes: 120,
      },
    };

    const first = buildAnalyticsSnapshotCacheKey('player-ranking', '1', input);
    expect(first).toBe(buildAnalyticsSnapshotCacheKey('player-ranking', '1', structuredClone(input)));
    expect(first).not.toBe(buildAnalyticsSnapshotCacheKey('player-ranking', '2', input));
    expect(first).not.toBe(buildAnalyticsSnapshotCacheKey('player-ranking', '1', {
      ...input,
      request: { ...input.request, minimumMinutes: 121 },
    }));
    expect(first).not.toBe(buildAnalyticsSnapshotCacheKey('record', '1', input));
  });

  it('rejects malformed epochs and oversized payloads instead of constructing unbounded keys', () => {
    expect(buildAnalyticsSnapshotCacheKey('player-ranking', '0', {})).toBeNull();
    expect(buildAnalyticsSnapshotCacheKey('player-ranking', 'not-an-epoch', {})).toBeNull();
    expect(buildAnalyticsSnapshotCacheKey('player-ranking', '1', { value: 'x'.repeat(40_000) })).toBeNull();
    expect(buildAnalyticsSnapshotCacheKey('unsafe/name', '1', {})).toBeNull();
  });

  it('does not accidentally invoke unrelated logging while building keys', () => {
    const spy = vi.spyOn(console, 'info');
    buildAnalyticsSnapshotCacheKey('team-power', '1', { competitionId: 'edition-1' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
