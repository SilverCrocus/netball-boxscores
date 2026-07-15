import { describe, expect, it } from 'vitest';
import { buildExploreResultModel } from '@/app/explore/result-model';
import type { StatQueryResponse } from '@/lib/stat-query/types';

function response(result: unknown): StatQueryResponse {
  return {
    status: 'READY',
    question: 'Who had the most goals?',
    interpretation: 'leaderboard: player · Goals · total · selected edition',
    spec: {
      version: 'query-spec.v1', intent: 'LEADERBOARD', subject: 'PLAYER', entityIds: [],
      metrics: [{ id: 'goals', aggregation: 'TOTAL' }],
      filters: { editionId: 'edition-1', officialCompletedOnly: true, excludeSimulations: true },
      window: { type: 'EDITION' }, groupBy: 'ENTITY', order: 'DESC', minimumMinutes: 120, limit: 10,
    },
    answer: 'Grace Nweke leads with 220 goals.',
    result,
    audit: { parserVersion: 'centrepass-rules.v1', latencyMs: 42, cache: 'MISS', asOf: '2026-07-04T09:30:00.000Z' },
  };
}

describe('buildExploreResultModel', () => {
  it('normalizes ranking rows and deduplicates the included match audit', () => {
    const model = buildExploreResultModel(response({
      formulaVersion: 'goals.v1',
      entries: [
        { entity: { id: 'p1', name: 'Grace Nweke', position: 'GS', teamName: 'NSW Swifts' }, result: { value: 220, unit: 'COUNT', coverage: 'AVAILABLE', games: 5, minutes: 300, includedMatchIds: ['m1', 'm2'] } },
        { entity: { id: 'p2', name: 'Sophie Garbin', position: 'GS', teamName: 'Melbourne Vixens' }, result: { value: 205, unit: 'COUNT', coverage: 'PARTIAL', games: 5, minutes: 298, includedMatchIds: ['m2', 'm3'] } },
      ],
    }));

    expect(model).toMatchObject({
      metricName: 'Goals', formulaVersion: 'goals.v1', coverageLabel: 'available · partial', chartable: true,
      includedMatchIds: ['m1', 'm2', 'm3'],
    });
    expect(model?.rows[0]).toMatchObject({ label: 'Grace Nweke', valueLabel: '220', href: '/player/p1' });
  });

  it('returns an empty display model for an understood query without eligible rows', () => {
    const model = buildExploreResultModel(response({ entries: [] }));
    expect(model?.rows).toEqual([]);
    expect(model?.coverageLabel).toBe('unavailable');
  });
});
