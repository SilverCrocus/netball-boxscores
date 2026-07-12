import { describe, expect, it } from 'vitest';
import { getScoreFlowIdentity, mergeScoreFlows } from '@/lib/score-flow';

describe('score-flow identity', () => {
  it('includes the scoring team', () => {
    const home = { period: 1, periodSeconds: 200, scoringTeamId: 'home' };
    const away = { period: 1, periodSeconds: 200, scoringTeamId: 'away' };

    expect(getScoreFlowIdentity(home)).not.toBe(getScoreFlowIdentity(away));
  });

  it('merges SSR and socket entries without dropping simultaneous opposing scores', () => {
    const initial = [{ period: 1, periodSeconds: 200, scoringTeamId: 'home', homeScore: 1, awayScore: 0 }];
    const socket = [
      { period: 1, periodSeconds: 200, scoringTeamId: 'home', homeScore: 1, awayScore: 0 },
      { period: 1, periodSeconds: 200, scoringTeamId: 'away', homeScore: 1, awayScore: 1 },
    ];

    expect(mergeScoreFlows(initial, socket)).toEqual([
      initial[0],
      socket[1],
    ]);
  });

  it('orders simultaneous entries by cumulative score and replaces corrected identities', () => {
    const later = { period: 1, periodSeconds: 200, scoringTeamId: 'away', homeScore: 1, awayScore: 1, scorePoints: 1 };
    const earlier = { period: 1, periodSeconds: 200, scoringTeamId: 'home', homeScore: 1, awayScore: 0, scorePoints: 1 };
    const correction = { ...earlier, scorePoints: 2 };

    expect(mergeScoreFlows([later, earlier], [correction])).toEqual([correction, later]);
  });
});
