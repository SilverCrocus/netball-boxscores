import { describe, expect, it } from 'vitest';
import type { PlayerMatchStats } from '@prisma/client';
import {
  computeProgressPercentage,
  computeTrend,
} from './PlayerSeasonStats';

describe('player season metrics', () => {
  it('compares the newest-first stat entries in the correct direction', () => {
    const stats = [
      { goals: 30 },
      { goals: 20 },
    ] as PlayerMatchStats[];

    expect(computeTrend(stats, 'goals')).toEqual({
      value: '+50%',
      positive: true,
    });
  });

  it('shows aggregate progress relative to the best-game pace across all games', () => {
    expect(computeProgressPercentage(60, 40, 2, false)).toBe(75);
  });

  it('uses the percentage value directly for percentage progress', () => {
    expect(computeProgressPercentage(83.2, 100, 8, true)).toBe(83.2);
  });
});
