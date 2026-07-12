import { describe, it, expect } from 'vitest';
import type { SimMatch } from '@/lib/simulation/types';
import { buildFixtureResponse, buildMatchStatsResponse } from '@/lib/simulation/data-generator';

function makeSimMatch(overrides: Partial<SimMatch> = {}): SimMatch {
  return {
    matchIndex: 0,
    championDataMatchId: 99001,
    prismaMatchId: 'match-1',
    state: 'q2-active',
    homeSquadId: 810,
    homeSquadName: 'Melbourne Vixens',
    homeSquadCode: 'VIX',
    awaySquadId: 811,
    awaySquadName: 'West Coast Fever',
    awaySquadCode: 'FEV',
    homeScore: 30,
    awayScore: 28,
    period: 2,
    periodSeconds: 450,
    tickCount: 20,
    scoreFlow: [
      { period: 1, periodSeconds: 100, squadId: 810, scorepoints: 1, homeScore: 1, awayScore: 0 },
      { period: 1, periodSeconds: 200, squadId: 811, scorepoints: 1, homeScore: 1, awayScore: 1 },
    ],
    playerStats: [
      {
        playerId: 1001, displayName: 'Test Player', position: 'GS', squadId: 810,
        goals: 5, attempts: 7, goalAssists: 0, intercepts: 0, deflections: 0,
        rebounds: 0, penalties: 0, feeds: 1, centrePassReceives: 0, turnovers: 1, minutesPlayed: 15,
      },
    ],
    homePlayers: [{ championDataPlayerId: 1001, name: 'Test Player', position: 'GS', squadId: 810 }],
    awayPlayers: [],
    venue: 'John Cain Arena',
    startOffset: 0,
    ...overrides,
  };
}

describe('data-generator', () => {
  describe('buildFixtureResponse', () => {
    it('returns CDFixtureResponse shape', () => {
      const matches = [makeSimMatch()];
      const result = buildFixtureResponse(matches);

      expect(result).toHaveProperty('fixture');
      expect(result.fixture).toHaveProperty('jobId');
      expect(result.fixture).toHaveProperty('match');
      expect(result.fixture.match).toHaveLength(1);
    });

    it('maps matchStatus correctly for playing state', () => {
      const matches = [makeSimMatch({ state: 'q2-active' })];
      const result = buildFixtureResponse(matches);
      expect(result.fixture.match[0].matchStatus).toBe('playing');
    });

    it('maps matchStatus correctly for scheduled state', () => {
      const matches = [makeSimMatch({ state: 'pre-match' })];
      const result = buildFixtureResponse(matches);
      expect(result.fixture.match[0].matchStatus).toBe('scheduled');
    });

    it('maps matchStatus correctly for complete state', () => {
      const matches = [makeSimMatch({ state: 'match-complete' })];
      const result = buildFixtureResponse(matches);
      expect(result.fixture.match[0].matchStatus).toBe('complete');
    });

    it('includes correct squad IDs and scores', () => {
      const matches = [makeSimMatch()];
      const result = buildFixtureResponse(matches);
      const m = result.fixture.match[0];
      expect(m.homeSquadId).toBe(810);
      expect(m.awaySquadId).toBe(811);
      expect(m.homeSquadScore).toBe(30);
      expect(m.awaySquadScore).toBe(28);
    });
  });

  describe('buildMatchStatsResponse', () => {
    it('returns CDMatchStatsResponse shape', () => {
      const match = makeSimMatch();
      const result = buildMatchStatsResponse(match);

      expect(result).toHaveProperty('matchInfo');
      expect(result).toHaveProperty('scoreFlow');
      expect(result).toHaveProperty('playerStats');
      expect(result).toHaveProperty('periodScores');
      expect(result).toHaveProperty('teamStats');
    });

    it('has correct matchInfo values', () => {
      const match = makeSimMatch();
      const result = buildMatchStatsResponse(match);

      expect(result.matchInfo.matchId).toBe(99001);
      expect(result.matchInfo.homeScore).toBe(30);
      expect(result.matchInfo.awayScore).toBe(28);
      expect(result.matchInfo.period).toBe(2);
      expect(result.matchInfo.periodSeconds).toBe(450);
    });

    it('includes score flow entries', () => {
      const match = makeSimMatch();
      const result = buildMatchStatsResponse(match);
      expect(result.scoreFlow).toHaveLength(2);
    });

    it('splits playerStats into home and away', () => {
      const match = makeSimMatch();
      const result = buildMatchStatsResponse(match);
      expect(result.playerStats).toHaveProperty('home');
      expect(result.playerStats).toHaveProperty('away');
    });
  });
});
