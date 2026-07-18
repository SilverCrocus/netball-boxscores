import { describe, expect, it } from 'vitest';
import { resolveCapability, resolveEditionFeatures, isFinalFixture } from '@/lib/edition-capabilities';
import { hasResolvedMatchTeams, projectMatchSides } from '@/lib/edition-match';
import { periodLabel, pointsForResult, stageLabel } from '@/lib/edition-rules';
import { formatEditionMatchTimes } from '@/lib/edition-time';

describe('edition capability gates', () => {
  it('treats missing coverage as unavailable instead of zero', () => {
    expect(resolveCapability('NET_POINTS', [])).toEqual({
      capability: 'NET_POINTS',
      state: 'UNAVAILABLE',
      scope: 'missing',
      available: false,
    });
  });

  it('lets match coverage override edition coverage', () => {
    const features = resolveEditionFeatures(
      [{ capability: 'SCORE_FLOW', state: 'AVAILABLE' }],
      [{ capability: 'SCORE_FLOW', state: 'UNAVAILABLE' }]
    );
    expect(features.scoreFlow).toMatchObject({
      state: 'UNAVAILABLE',
      scope: 'match',
      available: false,
    });
  });

  it('fails every public match surface closed when coverage is unavailable', () => {
    const features = resolveEditionFeatures([
      { capability: 'FINAL_SCORE', state: 'UNAVAILABLE' },
      { capability: 'PERIOD_SCORES', state: 'UNAVAILABLE' },
      { capability: 'TEAM_BOX_SCORE', state: 'UNAVAILABLE' },
      { capability: 'PLAYER_BOX_SCORE', state: 'UNAVAILABLE' },
      { capability: 'SCORE_FLOW', state: 'UNAVAILABLE' },
      { capability: 'MATCH_EVENTS', state: 'UNAVAILABLE' },
      { capability: 'LINEUPS', state: 'UNAVAILABLE' },
    ]);

    expect(features.finalScore.available).toBe(false);
    expect(features.periodScores.available).toBe(false);
    expect(features.teamBoxScore.available).toBe(false);
    expect(features.playerBoxScore.available).toBe(false);
    expect(features.scoreFlow.available).toBe(false);
    expect(features.matchEvents.available).toBe(false);
    expect(features.lineups.available).toBe(false);
  });
});

describe('provider-neutral match projections', () => {
  it('accepts resolved tournament teams without requiring a numerical round', () => {
    expect(hasResolvedMatchTeams({
      homeTeamId: 'eng',
      awayTeamId: 'sco',
      round: null,
      homeTeam: { id: 'eng' },
      awayTeam: { id: 'sco' },
    })).toBe(true);
  });

  it('renders neutral unresolved fixtures without home-away claims', () => {
    const projected = projectMatchSides({
      neutralVenue: true,
      slots: [
        {
          side: 'A',
          resolvedEntry: {
            displayName: 'Australia',
            team: { id: 'aus', name: 'Australia' },
          },
        },
        { side: 'B', sourceLabel: 'Pool B winner' },
      ],
    });

    expect(projected.sideA).toMatchObject({ role: 'Team A', displayName: 'Australia' });
    expect(projected.sideB).toMatchObject({
      role: 'Team B',
      displayName: 'Pool B winner',
      resolved: false,
    });
    expect(projected.hasHomeAdvantage).toBe(false);
  });
});

describe('edition rules and lifecycle', () => {
  it('uses the configured standings strategy', () => {
    expect(pointsForResult('SSN_4_2_0', 'WIN')).toBe(4);
    expect(pointsForResult('WORLD_NETBALL_2_1_0', 'WIN')).toBe(2);
  });

  it('labels regulation, extra-time, and stage contexts', () => {
    expect(periodLabel(4, 4)).toBe('Q4');
    expect(periodLabel(5, 4)).toBe('Extra time 1');
    expect(stageLabel({ type: 'POOL' })).toBe('Pool stage');
    expect(stageLabel({ name: 'Pool A' }, 'Day 2')).toBe('Day 2');
  });

  it.each(['SCHEDULED', 'DELAYED', 'POSTPONED'] as const)(
    'never renders %s as final',
    (status) => {
      expect(isFinalFixture(status, 'OFFICIAL_FINAL')).toBe(false);
    }
  );

  it('requires both completed lifecycle and final result quality', () => {
    expect(isFinalFixture('COMPLETED', 'OFFICIAL_FINAL')).toBe(true);
    expect(isFinalFixture('COMPLETED', 'PROVISIONAL')).toBe(false);
  });
});

describe('edition time formatting', () => {
  it('distinguishes venue-local and viewer-local time', () => {
    const result = formatEditionMatchTimes(
      new Date('2026-07-25T08:00:00Z'),
      'Europe/London',
      'Australia/Sydney'
    );

    expect(result.sameTimeZone).toBe(false);
    expect(result.venueTimeZone).toBe('Europe/London');
    expect(result.viewerTimeZone).toBe('Australia/Sydney');
    expect(result.venue).not.toBe(result.viewer);
  });
});
