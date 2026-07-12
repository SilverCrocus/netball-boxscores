import { describe, expect, it } from 'vitest';
import { getMvpSupportingStats } from '@/lib/mvp-stats';

const baseStats = {
  position: 'C' as const,
  goals: 0,
  attempts: 0,
  goalAssists: 0,
  feeds: 0,
  gain: 0,
  intercepts: 0,
  deflections: 0,
};

describe('getMvpSupportingStats', () => {
  it('shows defensive contributions instead of goal assists for a defender', () => {
    expect(getMvpSupportingStats({
      ...baseStats,
      position: 'GD',
      goalAssists: 0,
      gain: 7,
      intercepts: 2,
      deflections: 8,
    })).toEqual([
      { label: 'Gains', value: 7 },
      { label: 'Deflections', value: 8 },
    ]);
  });

  it('uses interceptions when they are the stronger defensive stat', () => {
    expect(getMvpSupportingStats({
      ...baseStats,
      position: 'GK',
      gain: 6,
      intercepts: 5,
      deflections: 3,
    })[1]).toEqual({ label: 'Intercepts', value: 5 });
  });

  it('shows scoring output and accuracy for a shooter', () => {
    expect(getMvpSupportingStats({
      ...baseStats,
      position: 'GS',
      goals: 42,
      attempts: 45,
    })).toEqual([
      { label: 'Goals', value: 42 },
      { label: 'Goal %', value: '93%' },
    ]);
  });

  it('shows distribution stats for a midcourt player', () => {
    expect(getMvpSupportingStats({
      ...baseStats,
      position: 'WA',
      goalAssists: 20,
      feeds: 35,
    })).toEqual([
      { label: 'Goal Ast', value: 20 },
      { label: 'Feeds', value: 35 },
    ]);
  });
});
