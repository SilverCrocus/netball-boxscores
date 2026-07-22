import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_SNAPSHOT_CACHE_SAFE_LIMIT_BYTES,
  NEXT_CACHE_ENTRY_LIMIT_BYTES,
  serializedAnalyticsSnapshotBytes,
} from '@/lib/analytics/snapshot-cache';

describe('analytics snapshot cache payloads', () => {
  it('measures a deterministic representative DTO below the Next entry ceiling', () => {
    const snapshot = {
      rankingType: 'PLAYER_METRIC',
      methodVersion: 'centrepass-player-ranking.v1',
      formulaVersion: 'goals.v1',
      scopeKey: 'edition:glasgow-2026|metric:goals|aggregation:TOTAL',
      request: {
        competitionId: 'glasgow-2026',
        metricId: 'goals',
        aggregation: 'TOTAL',
        minimumMinutes: 120,
        from: '2026-03-01T00:00:00.000Z',
        to: '2026-06-30T00:00:00.000Z',
      },
      asOf: '2026-07-22T00:00:00.000Z',
      populationSize: 96,
      entries: Array.from({ length: 96 }, (_, index) => ({
        rank: index + 1,
        percentile: 99 - index,
        entity: {
          id: `player-${index + 1}`,
          name: `Representative player ${index + 1}`,
          position: 'GS',
          teamName: `Team ${index % 12 + 1}`,
        },
        result: {
          metricId: 'goals',
          value: 42,
          status: 'AVAILABLE',
          unit: 'COUNT',
          aggregation: 'TOTAL',
          context: {
            entityType: 'PLAYER',
            entityId: `player-${index + 1}`,
            competitionId: 'glasgow-2026',
            window: {
              from: '2026-03-01T00:00:00.000Z',
              to: '2026-06-30T00:00:00.000Z',
            },
          },
          games: 12,
          minutes: 480,
          minimumSample: { minutes: 120 },
          minimumSampleMet: true,
          coverage: 'AVAILABLE',
          formulaVersion: 'goals.v1',
          asOf: '2026-07-22T00:00:00.000Z',
          includedMatchIds: Array.from({ length: 14 }, (_, match) => `match-${match + 1}`),
        },
        movement: null,
        movementLabel: 'NEW',
      })),
    };

    const first = serializedAnalyticsSnapshotBytes(snapshot);
    const second = serializedAnalyticsSnapshotBytes(snapshot);
    expect(first).toBe(second);
    expect(first).toBeLessThan(ANALYTICS_SNAPSHOT_CACHE_SAFE_LIMIT_BYTES);
    expect(ANALYTICS_SNAPSHOT_CACHE_SAFE_LIMIT_BYTES).toBeLessThan(NEXT_CACHE_ENTRY_LIMIT_BYTES);
  });
});
