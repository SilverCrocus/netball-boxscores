import { describe, expect, it } from 'vitest';
import type { AnalyticsFact } from '@/lib/analytics';
import { calculatePlayerRankingSnapshot, calculateTeamPowerSnapshot, TEAM_POWER_METHODOLOGY } from '@/lib/rankings';
import type { TeamPowerMatch } from '@/lib/rankings';

function playerFact(
  playerId: string,
  position: string,
  matchId: string,
  minutes: number,
  stats: AnalyticsFact['stats'],
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
  };
}

function powerMatch(overrides: Partial<TeamPowerMatch> = {}): TeamPowerMatch {
  return {
    id: 'match-1',
    competitionId: 'edition-1',
    competitionSeriesId: 'series-1',
    competitionKind: 'LEAGUE',
    scheduledAt: new Date('2026-05-01T10:00:00Z'),
    neutralVenue: false,
    homeTeamId: 'home',
    awayTeamId: 'away',
    homeScore: 60,
    awayScore: 50,
    ...overrides,
  };
}

describe('player ranking snapshots', () => {
  it('ranks only eligible samples and identifies the first snapshot as new', () => {
    const facts = [
      playerFact('one', 'GK', '01', 60, { intercepts: 5 }),
      playerFact('two', 'GK', '02', 60, { intercepts: 2 }),
      playerFact('short', 'GK', '03', 10, { intercepts: 10 }),
    ];
    const snapshot = calculatePlayerRankingSnapshot(facts, [
      { id: 'one', name: 'One', position: 'GK' },
      { id: 'two', name: 'Two', position: 'GK' },
      { id: 'short', name: 'Short', position: 'GK' },
    ], {
      competitionId: 'edition-1',
      metricId: 'intercepts',
      aggregation: 'PER_60',
      position: 'GK',
      minimumMinutes: 30,
    });

    expect(snapshot.populationSize).toBe(2);
    expect(snapshot.entries.map((entry) => entry.entity.id)).toEqual(['one', 'two']);
    expect(snapshot.entries.every((entry) => entry.movementLabel === 'NEW' && entry.movement === null)).toBe(true);
    expect(snapshot.scopeKey).toContain('minimum_minutes:30');
    expect(snapshot.formulaVersion).toBe('intercepts.v1');
  });

  it('applies last-N independently to each player', () => {
    const facts = [
      playerFact('one', 'WA', '01', 60, { feeds: 100 }),
      playerFact('one', 'WA', '03', 60, { feeds: 10 }),
      playerFact('two', 'WA', '02', 60, { feeds: 20 }),
      playerFact('two', 'WA', '04', 60, { feeds: 30 }),
    ];
    const snapshot = calculatePlayerRankingSnapshot(facts, [
      { id: 'one', name: 'One', position: 'WA' },
      { id: 'two', name: 'Two', position: 'WA' },
    ], {
      competitionId: 'edition-1',
      metricId: 'feeds',
      aggregation: 'PER_GAME',
      lastN: 1,
      minimumMinutes: 0,
    });
    expect(snapshot.entries[0].entity.id).toBe('two');
    expect(snapshot.entries[0].result.includedMatchIds).toEqual(['04']);
  });
});

describe('team power snapshots', () => {
  const teams = [
    { id: 'home', name: 'Home', slug: 'home' },
    { id: 'away', name: 'Away', slug: 'away' },
  ];

  it('is zero-sum and publishes its method and sample', () => {
    const snapshot = calculateTeamPowerSnapshot('edition-1', [powerMatch()], teams);
    expect(snapshot.methodVersion).toBe(TEAM_POWER_METHODOLOGY.version);
    expect(snapshot.entries[0]).toMatchObject({ entity: { id: 'home' }, games: 1, wins: 1, movementLabel: 'NEW' });
    expect(snapshot.entries[0].rating + snapshot.entries[1].rating).toBeCloseTo(3000, 6);
    expect(snapshot.entries.every((entry) => entry.includedMatchIds.includes('match-1'))).toBe(true);
  });

  it('removes home advantage at neutral venues and for tournaments', () => {
    const neutral = calculateTeamPowerSnapshot('edition-1', [powerMatch({ neutralVenue: true })], teams);
    const tournamentHome = calculateTeamPowerSnapshot('edition-1', [powerMatch({
      competitionKind: 'TOURNAMENT',
      neutralVenue: false,
    })], teams);
    const tournamentNeutral = calculateTeamPowerSnapshot('edition-1', [powerMatch({
      competitionKind: 'TOURNAMENT',
      neutralVenue: true,
    })], teams);
    const league = calculateTeamPowerSnapshot('edition-1', [powerMatch()], teams);
    expect(tournamentHome.entries[0].rating).toBe(tournamentNeutral.entries[0].rating);
    expect(neutral.entries[0].rating).toBeGreaterThan(league.entries[0].rating);
  });

  it('rejects mixed competition series', () => {
    expect(() => calculateTeamPowerSnapshot('edition-1', [
      powerMatch(),
      powerMatch({ id: 'match-2', competitionSeriesId: 'series-2' }),
    ], teams)).toThrow('cannot mix competition types or series');
  });
});
