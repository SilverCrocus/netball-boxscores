import { describe, expect, it } from 'vitest';
import { calculateMetric } from '@/lib/analytics/aggregate';
import type { AnalyticsFact, MetricQueryContext } from '@/lib/analytics/types';

const context: MetricQueryContext = {
  entityType: 'PLAYER',
  entityId: 'player-1',
  competitionId: 'ssn-2026',
};

function fact(
  matchId: string,
  scheduledAt: string,
  stats: AnalyticsFact['stats'],
  overrides: Partial<AnalyticsFact> = {},
): AnalyticsFact {
  return {
    entityType: 'PLAYER',
    entityId: 'player-1',
    matchId,
    competitionId: 'ssn-2026',
    competitionSeriesId: 'ssn',
    competitionKind: 'LEAGUE',
    stageId: 'regular-season',
    stageGroupId: null,
    position: 'GA',
    scheduledAt: new Date(scheduledAt),
    sourceUpdatedAt: new Date(scheduledAt),
    status: 'COMPLETED',
    resultQuality: 'OFFICIAL_FINAL',
    isSimulation: false,
    capabilities: { PLAYER_BOX_SCORE: 'AVAILABLE', NET_POINTS: 'AVAILABLE' },
    stats,
    ...overrides,
  };
}

describe('shared analytics aggregation policy', () => {
  it('calculates totals, per-game values, and per-60 values from the same facts', () => {
    const facts = [
      fact('m1', '2026-05-01T10:00:00Z', { goals: 20, minutesPlayed: 60 }),
      fact('m2', '2026-05-08T10:00:00Z', { goals: 30, minutesPlayed: 45 }),
    ];

    expect(calculateMetric('goals', facts, context, 'TOTAL').value).toBe(50);
    expect(calculateMetric('goals', facts, context, 'PER_GAME').value).toBe(25);
    expect(calculateMetric('goals', facts, context, 'PER_60').value).toBe(28.57);
  });

  it('uses a weighted percentage instead of averaging match percentages', () => {
    const facts = [
      fact('m1', '2026-05-01T10:00:00Z', { goals: 9, attempts: 10, minutesPlayed: 60 }),
      fact('m2', '2026-05-08T10:00:00Z', { goals: 1, attempts: 10, minutesPlayed: 60 }),
    ];

    const result = calculateMetric('goal_accuracy', facts, context);
    expect(result.value).toBe(50);
    expect(result.games).toBe(2);
  });

  it('selects last-N official matches before coverage filtering', () => {
    const facts = [
      fact('older-covered', '2026-05-01T10:00:00Z', { goals: 50, minutesPlayed: 60 }),
      fact(
        'latest-uncovered',
        '2026-05-08T10:00:00Z',
        { goals: null, minutesPlayed: 60 },
        { capabilities: { PLAYER_BOX_SCORE: 'UNAVAILABLE' } },
      ),
    ];

    const result = calculateMetric('goals', facts, {
      ...context,
      window: { lastN: 1 },
    });

    expect(result.status).toBe('UNAVAILABLE');
    expect(result.value).toBeNull();
    expect(result.includedMatchIds).toEqual([]);
  });

  it('never lets unavailable fields enter an aggregate', () => {
    const facts = [
      fact('covered', '2026-05-01T10:00:00Z', { goals: 20, minutesPlayed: 60 }),
      fact(
        'uncovered',
        '2026-05-08T10:00:00Z',
        { goals: 999, minutesPlayed: 60 },
        { capabilities: { PLAYER_BOX_SCORE: 'UNAVAILABLE' } },
      ),
    ];

    const result = calculateMetric('goals', facts, context, 'TOTAL');
    expect(result.value).toBe(20);
    expect(result.coverage).toBe('PARTIAL');
    expect(result.includedMatchIds).toEqual(['covered']);
  });

  it('excludes provisional, incomplete, and simulation matches centrally', () => {
    const facts = [
      fact('official', '2026-05-01T10:00:00Z', { goals: 10, minutesPlayed: 60 }),
      fact('provisional', '2026-05-02T10:00:00Z', { goals: 90, minutesPlayed: 60 }, { resultQuality: 'PROVISIONAL' }),
      fact('live', '2026-05-03T10:00:00Z', { goals: 90, minutesPlayed: 60 }, { status: 'LIVE' }),
      fact('simulation', '2026-05-04T10:00:00Z', { goals: 90, minutesPlayed: 60 }, { isSimulation: true }),
    ];

    expect(calculateMetric('goals', facts, context, 'TOTAL')).toMatchObject({
      value: 10,
      games: 1,
      includedMatchIds: ['official'],
    });
  });

  it('applies minimum minutes and attempt samples', () => {
    const short = [fact('m1', '2026-05-01T10:00:00Z', { intercepts: 1, minutesPlayed: 10 })];
    expect(calculateMetric('intercepts', short, context, 'PER_60')).toMatchObject({
      status: 'INSUFFICIENT_SAMPLE',
      value: null,
      minimumSampleMet: false,
    });

    const lowAttempts = [fact('m2', '2026-05-08T10:00:00Z', { goals: 4, attempts: 5, minutesPlayed: 60 })];
    expect(calculateMetric('goal_accuracy', lowAttempts, context)).toMatchObject({
      status: 'INSUFFICIENT_SAMPLE',
      value: null,
    });
  });

  it('cannot mix competitions into one result', () => {
    const facts = [
      fact('league', '2026-05-01T10:00:00Z', { goals: 10, minutesPlayed: 60 }),
      fact(
        'international',
        '2026-07-25T10:00:00Z',
        { goals: 70, minutesPlayed: 60 },
        { competitionId: 'glasgow-2026', competitionSeriesId: 'commonwealth-games', competitionKind: 'TOURNAMENT' },
      ),
    ];

    expect(calculateMetric('goals', facts, context, 'TOTAL').value).toBe(10);
  });

  it('orders tied timestamps deterministically for last-N windows', () => {
    const facts = [
      fact('match-a', '2026-05-01T10:00:00Z', { goals: 10, minutesPlayed: 60 }),
      fact('match-b', '2026-05-01T10:00:00Z', { goals: 20, minutesPlayed: 60 }),
    ];

    expect(calculateMetric('goals', facts, { ...context, window: { lastN: 1 } }, 'TOTAL'))
      .toMatchObject({ value: 20, includedMatchIds: ['match-b'] });
  });

  it('calculates registered composite and ratio metrics deterministically', () => {
    const facts = [fact('m1', '2026-05-01T10:00:00Z', {
      goalAssists: 4,
      feeds: 10,
      centrePassReceives: 6,
      gain: 3,
      turnovers: 2,
      minutesPlayed: 60,
    })];

    expect(calculateMetric('attacking_involvement', facts, context, 'TOTAL').value).toBe(20);
    expect(calculateMetric('gain_to_turnover_ratio', facts, context, 'RATING').value).toBe(1.5);
  });

  it('routes CentrePass Impact to its reviewed service instead of a generic formula', () => {
    expect(() => calculateMetric('centrepass_impact', [], context, 'RATING'))
      .toThrow('CENTREPASS_IMPACT_V1');
  });
});
