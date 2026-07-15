import { describe, expect, it } from 'vitest';
import type { AnalyticsFact } from '@/lib/analytics';
import { calculatePlayerComparison } from '@/lib/comparison';

function fact(playerId: string, position: string, matchId: string, stats: AnalyticsFact['stats'], overrides: Partial<AnalyticsFact> = {}): AnalyticsFact {
  return {
    entityType: 'PLAYER', entityId: playerId, matchId, competitionId: 'edition-1',
    competitionSeriesId: 'series-1', competitionKind: 'LEAGUE', position,
    scheduledAt: new Date(`2026-05-${matchId.padStart(2, '0')}T10:00:00Z`), sourceUpdatedAt: null,
    status: 'COMPLETED', resultQuality: 'OFFICIAL_FINAL', isSimulation: false,
    capabilities: { PLAYER_BOX_SCORE: 'AVAILABLE' }, stats: { minutesPlayed: 60, ...stats }, ...overrides,
  };
}

const players = [
  { id: 'left', name: 'Left', position: 'GS', teamName: 'A' },
  { id: 'right', name: 'Right', position: 'GK', teamName: 'B' },
  { id: 'shooting-peer', name: 'Shooting Peer', position: 'GS', teamName: 'C' },
  { id: 'defending-peer', name: 'Defending Peer', position: 'GK', teamName: 'D' },
];

describe('player comparison', () => {
  it('leads cross-position comparisons with position percentiles and discloses samples', () => {
    const facts = [
      fact('left', 'GS', '01', { goals: 50, turnovers: 2 }),
      fact('right', 'GK', '02', { goals: 1, turnovers: 1 }),
      fact('shooting-peer', 'GS', '03', { goals: 30, turnovers: 4 }),
      fact('defending-peer', 'GK', '04', { goals: 0, turnovers: 3 }),
    ];
    const result = calculatePlayerComparison(facts, players, {
      leftPlayerId: 'left', rightPlayerId: 'right', leftCompetitionId: 'edition-1', rightCompetitionId: 'edition-1',
      aggregation: 'PER_GAME', metricIds: ['goals', 'turnovers'],
    });
    expect(result).toMatchObject({ crossPosition: true, leadWithPercentiles: true });
    expect(result.metrics[0].left.positionPercentile).toBe(75);
    expect(result.metrics[0].left.result).toMatchObject({ games: 1, minutes: 60, includedMatchIds: ['01'] });
    expect(result.metrics.every((metric) => metric.formulaVersion.length > 0)).toBe(true);
  });

  it('uses the last-N window independently and warns about unequal samples', () => {
    const facts = [
      fact('left', 'GS', '01', { goals: 20 }), fact('left', 'GS', '03', { goals: 40 }),
      fact('right', 'GK', '02', { goals: 1 }),
    ];
    const result = calculatePlayerComparison(facts, players, {
      leftPlayerId: 'left', rightPlayerId: 'right', leftCompetitionId: 'edition-1', rightCompetitionId: 'edition-1',
      aggregation: 'TOTAL', metricIds: ['goals'], lastN: 1,
    });
    expect(result.metrics[0].left.result.includedMatchIds).toEqual(['03']);
    expect(result.warnings).toEqual([]);
  });

  it('rejects cross-competition metrics with incompatible coverage', () => {
    const facts = [
      fact('left', 'GS', '01', { goals: 20 }),
      fact('right', 'GK', '02', { goals: 2 }, { competitionId: 'edition-2', capabilities: { PLAYER_BOX_SCORE: 'PARTIAL' } }),
    ];
    const result = calculatePlayerComparison(facts, players, {
      leftPlayerId: 'left', rightPlayerId: 'right', leftCompetitionId: 'edition-1', rightCompetitionId: 'edition-2',
      aggregation: 'TOTAL', metricIds: ['goals'],
    });
    expect(result.metrics).toEqual([]);
    expect(result.rejectedMetrics).toEqual([{ metricId: 'goals', reason: 'INCOMPATIBLE_COVERAGE' }]);
  });

  it('rejects unsafe or ambiguous comparison shapes', () => {
    expect(() => calculatePlayerComparison([], players, {
      leftPlayerId: 'left', rightPlayerId: 'left', leftCompetitionId: 'edition-1', rightCompetitionId: 'edition-1',
      aggregation: 'TOTAL', metricIds: ['goals'],
    })).toThrow('two different players');
  });
});

