import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SimMatch, SimState } from '@/lib/simulation/types';

// Mock prisma for DB setup
vi.mock('@/lib/db', () => ({
  prisma: {
    team: { findMany: vi.fn() },
    player: { findMany: vi.fn() },
    match: { create: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    competition: { findFirst: vi.fn() },
    matchQuarter: { deleteMany: vi.fn() },
    playerMatchStats: { deleteMany: vi.fn() },
    scoreFlow: { deleteMany: vi.fn() },
  },
}));

import {
  createSimState,
  tickMatch,
  advanceState,
  generateGoals,
  resetBreakTicks,
} from '@/lib/simulation/engine';

describe('simulation engine', () => {
  beforeEach(() => {
    resetBreakTicks();
  });

  describe('createSimState', () => {
    it('creates a SimState with default config', () => {
      const state = createSimState({ matchCount: 2, speed: 1, tickStep: 30 });
      expect(state.running).toBe(false);
      expect(state.paused).toBe(false);
      expect(state.config.matchCount).toBe(2);
      expect(state.matches).toEqual([]);
    });
  });

  describe('advanceState', () => {
    it('transitions from pre-match to q1-active', () => {
      expect(advanceState('pre-match')).toBe('q1-active');
    });

    it('transitions from q1-active to q1-break', () => {
      expect(advanceState('q1-active')).toBe('q1-break');
    });

    it('transitions from q4-active to match-complete', () => {
      expect(advanceState('q4-active')).toBe('match-complete');
    });

    it('does not advance past match-complete', () => {
      expect(advanceState('match-complete')).toBe('match-complete');
    });
  });

  describe('tickMatch', () => {
    function makeMatch(overrides: Partial<SimMatch> = {}): SimMatch {
      return {
        matchIndex: 0,
        championDataMatchId: 99001,
        prismaMatchId: 'match-1',
        state: 'q1-active',
        homeSquadId: 810,
        homeSquadName: 'Melbourne Vixens',
        homeSquadCode: 'VIX',
        awaySquadId: 811,
        awaySquadName: 'West Coast Fever',
        awaySquadCode: 'FEV',
        homeScore: 0,
        awayScore: 0,
        period: 1,
        periodSeconds: 0,
        tickCount: 0,
        scoreFlow: [],
        playerStats: [],
        homePlayers: [],
        awayPlayers: [],
        venue: 'John Cain Arena',
        startOffset: 0,
        ...overrides,
      };
    }

    it('advances periodSeconds by tickStep in active state', () => {
      const match = makeMatch({ state: 'q1-active', periodSeconds: 0 });
      const result = tickMatch(match, 30);
      expect(result.periodSeconds).toBe(30);
      expect(result.tickCount).toBe(1);
    });

    it('transitions to break when periodSeconds reaches 900', () => {
      const match = makeMatch({ state: 'q1-active', periodSeconds: 880 });
      const result = tickMatch(match, 30);
      expect(result.state).toBe('q1-break');
      expect(result.periodSeconds).toBe(900);
    });

    it('does not advance periodSeconds in break state', () => {
      const match = makeMatch({ state: 'q1-break', periodSeconds: 900 });
      const result = tickMatch(match, 30);
      expect(result.periodSeconds).toBe(900);
      // Break lasts 2 ticks, so first tick stays in break
      expect(result.state).toBe('q1-break');
    });

    it('transitions from break to next quarter after 2 ticks', () => {
      const match = makeMatch({
        state: 'q1-break',
        periodSeconds: 900,
        tickCount: 1, // second tick in break
      });
      // Tick once — this is the "2nd break tick"
      const tick1 = tickMatch(match, 30);
      const tick2 = tickMatch(tick1, 30);
      expect(tick2.state).toBe('q2-active');
      expect(tick2.periodSeconds).toBe(0);
    });

    it('does not change match-complete state', () => {
      const match = makeMatch({ state: 'match-complete' });
      const result = tickMatch(match, 30);
      expect(result.state).toBe('match-complete');
    });

    it('respects startOffset — does not advance until offset reached', () => {
      const match = makeMatch({ state: 'pre-match', startOffset: 3, tickCount: 0 });
      const tick1 = tickMatch(match, 30);
      expect(tick1.state).toBe('pre-match');
      expect(tick1.tickCount).toBe(1);
    });
  });

  describe('generateGoals', () => {
    it('returns 0-2 goals for a team per tick', () => {
      // Run many iterations to check bounds
      const results = new Set<number>();
      for (let i = 0; i < 1000; i++) {
        results.add(generateGoals());
      }
      // Should only produce 0, 1, or 2
      for (const r of results) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(2);
      }
    });
  });
});
