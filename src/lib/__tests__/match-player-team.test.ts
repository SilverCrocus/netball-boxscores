import { describe, expect, it } from 'vitest';
import { playerTeamIdForMatch } from '@/lib/match-player-team';

describe('player match-side attribution', () => {
  it('uses the edition roster instead of a reused player club identity', () => {
    const player = {
      teamId: 'nsw-swifts',
      rosterMemberships: [
        { editionEntry: { competitionId: 'ssn-2026', teamId: 'nsw-swifts' } },
        { editionEntry: { competitionId: 'glasgow-2026', teamId: 'australia' } },
      ],
    };

    expect(playerTeamIdForMatch(
      player,
      'glasgow-2026',
      ['australia', 'england'],
    )).toBe('australia');
  });

  it('fails closed when no unique match-side roster membership exists', () => {
    expect(playerTeamIdForMatch(
      { rosterMemberships: [] },
      'glasgow-2026',
      ['australia', 'england'],
    )).toBeNull();
  });
});
