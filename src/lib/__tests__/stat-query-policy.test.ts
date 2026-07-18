import { describe, expect, it } from 'vitest';
import { inputPolicyError, validateQuerySpec } from '@/lib/stat-query/policy';
import { QUERY_SPEC_VERSION, type QuerySpecV1 } from '@/lib/stat-query/types';

function validSpec(overrides: Partial<QuerySpecV1> = {}): QuerySpecV1 {
  return {
    version: QUERY_SPEC_VERSION,
    intent: 'LOOKUP',
    subject: 'PLAYER',
    entityIds: ['player-1'],
    metrics: [{ id: 'goals', aggregation: 'PER_GAME' }],
    filters: { editionId: 'edition-1', officialCompletedOnly: true, excludeSimulations: true },
    window: { type: 'EDITION' },
    groupBy: 'NONE',
    order: 'DESC',
    minimumMinutes: 0,
    limit: 1,
    ...overrides,
  };
}

describe('stat query policy boundary', () => {
  it('accepts only catalogue metrics and supported aggregations', () => {
    expect(() => validateQuerySpec(validSpec())).not.toThrow();
    expect(() => validateQuerySpec(validSpec({ metrics: [{ id: 'private_column', aggregation: 'TOTAL' }] }))).toThrow('Metric is not allowlisted');
    expect(() => validateQuerySpec(validSpec({ metrics: [{ id: 'goal_accuracy', aggregation: 'TOTAL' }] }))).toThrow('Metric aggregation is not allowlisted');
    expect(() => validateQuerySpec(validSpec({ subject: 'TEAM', metrics: [{ id: 'centrepass_impact', aggregation: 'RATING' }] }))).toThrow('Metric does not support this subject');
  });

  it('rejects malformed IDs, unsupported cardinality, and unsafe scopes', () => {
    expect(() => validateQuerySpec(validSpec({ entityIds: ['player 1'] }))).toThrow('Entity ID is invalid');
    expect(() => validateQuerySpec(validSpec({ intent: 'LEADERBOARD', entityIds: ['player-1'] }))).toThrow('Leaderboard cannot target a specific entity');
    expect(() => validateQuerySpec(validSpec({ filters: { editionId: 'edition-1', position: 'COACH', officialCompletedOnly: true, excludeSimulations: true } }))).toThrow('Position is invalid');
  });

  it('rejects contradictory windows and shapes that the deterministic executor ignores', () => {
    expect(() => validateQuerySpec(validSpec({
      window: { type: 'EDITION', lastN: 5 },
    }))).toThrow('Edition window contains unsupported bounds');
    expect(() => validateQuerySpec(validSpec({
      window: { type: 'LAST_N' },
    }))).toThrow('Last-N window is incomplete');
    expect(() => validateQuerySpec(validSpec({
      groupBy: 'ENTITY',
    }))).toThrow('Lookup shape is invalid');
    expect(() => validateQuerySpec(validSpec({
      intent: 'RECORD', entityIds: [], groupBy: 'ENTITY', limit: 10,
    }))).toThrow('Record scope is invalid');
  });

  it('rejects filters unsupported by the selected calculation path', () => {
    expect(() => validateQuerySpec(validSpec({
      intent: 'COMPARISON',
      entityIds: ['player-1', 'player-2'],
      groupBy: 'ENTITY',
      limit: 2,
      filters: {
        editionId: 'edition-1', stageId: 'stage-1',
        officialCompletedOnly: true, excludeSimulations: true,
      },
    }))).toThrow('Comparison scope is not supported');
    expect(() => validateQuerySpec(validSpec({ minimumMinutes: 10 }))).toThrow(
      'Minimum minutes is supported only for player leaderboards',
    );
  });

  it('rejects SQL vocabulary, schema names, and control characters at the text boundary', () => {
    expect(inputPolicyError('call analytics.private_function')).toBeTruthy();
    expect(inputPolicyError('goals from information_schema')).toBeTruthy();
    expect(inputPolicyError('goals\u0000please')).toBeTruthy();
  });
});
