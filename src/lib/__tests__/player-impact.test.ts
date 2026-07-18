import { describe, expect, it } from 'vitest';
import type { AnalyticsFact } from '@/lib/analytics';
import {
  calculateCentrePassImpact,
  CENTREPASS_IMPACT_VERSION,
  impactPositionGroup,
} from '@/lib/player-impact';

function fact(
  playerId: string,
  position: string,
  matchId: string,
  minutes: number,
  stats: AnalyticsFact['stats'],
  overrides: Partial<AnalyticsFact> = {},
): AnalyticsFact {
  return {
    entityType: 'PLAYER',
    entityId: playerId,
    matchId,
    competitionId: 'edition-1',
    competitionSeriesId: 'series-1',
    competitionKind: 'LEAGUE',
    position,
    scheduledAt: new Date(`2026-05-${matchId.padStart(2, '0')}T10:00:00Z`),
    sourceUpdatedAt: null,
    status: 'COMPLETED',
    resultQuality: 'OFFICIAL_FINAL',
    isSimulation: false,
    capabilities: { PLAYER_BOX_SCORE: 'AVAILABLE' },
    stats: { minutesPlayed: minutes, ...stats },
    ...overrides,
  };
}

describe('CentrePass Impact v1', () => {
  it('uses compatible position groups and never mixes unrelated populations', () => {
    expect(impactPositionGroup('GS')).toBe('SHOOTER');
    expect(impactPositionGroup('WD')).toBe('MIDCOURT');
    expect(impactPositionGroup('GK')).toBe('DEFENDER');

    const facts = [
      fact('target', 'GK', '01', 60, { gain: 8, intercepts: 5, deflections: 7, rebounds: 3, pickups: 2, penalties: 10, turnovers: 1 }),
      fact('peer', 'GD', '02', 60, { gain: 3, intercepts: 2, deflections: 3, rebounds: 1, pickups: 1, penalties: 16, turnovers: 3 }),
      fact('shooter', 'GS', '03', 60, { goals: 60, attempts: 62, penalties: 1, turnovers: 0 }),
    ];

    const result = calculateCentrePassImpact(facts, 'target', 'edition-1', 'GK');
    expect(result).toMatchObject({
      status: 'AVAILABLE',
      populationSize: 2,
      positionGroup: 'DEFENDER',
      formulaVersion: CENTREPASS_IMPACT_VERSION,
    });
    expect(result.value).toBeGreaterThan(50);
    expect(result.percentile).toBe(75);
  });

  it('shrinks small samples toward 50 and enforces a minimum', () => {
    const short = [fact('target', 'WA', '01', 10, { goalAssists: 10, feeds: 20, centrePassReceives: 10 })];
    expect(calculateCentrePassImpact(short, 'target', 'edition-1', 'WA')).toMatchObject({
      status: 'INSUFFICIENT_SAMPLE',
      value: null,
      minutes: 10,
    });

    const enough = [
      fact('target', 'WA', '01', 60, { goalAssists: 10, feeds: 20, centrePassReceives: 10 }),
      fact('peer', 'C', '02', 60, { goalAssists: 2, feeds: 5, centrePassReceives: 5 }),
    ];
    const result = calculateCentrePassImpact(enough, 'target', 'edition-1', 'WA');
    expect(result.shrinkage).toBeCloseTo(0.33, 2);
    expect(result.value).toBeGreaterThan(50);
    expect(result.value).toBeLessThan(60);
  });

  it('excludes simulation and provisional facts and carries partial coverage', () => {
    const facts = [
      fact('target', 'GA', '01', 60, { goals: 30, attempts: 35 }, { capabilities: { PLAYER_BOX_SCORE: 'PARTIAL' } }),
      fact('target', 'GA', '02', 60, { goals: 100, attempts: 100 }, { isSimulation: true }),
      fact('target', 'GA', '03', 60, { goals: 100, attempts: 100 }, { resultQuality: 'PROVISIONAL' }),
    ];
    expect(calculateCentrePassImpact(facts, 'target', 'edition-1', 'GA')).toMatchObject({
      games: 1,
      minutes: 60,
      coverage: 'PARTIAL',
      includedMatchIds: ['01'],
    });
  });

  it('returns unavailable when the player has no compatible official facts', () => {
    expect(calculateCentrePassImpact([], 'missing', 'edition-1', 'C')).toMatchObject({
      status: 'UNAVAILABLE',
      value: null,
      populationSize: 0,
    });
  });
});
