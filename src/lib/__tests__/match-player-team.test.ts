import { describe, expect, it } from 'vitest';
import { playerTeamIdForMatch, rosterForMatch } from '@/lib/match-player-team';

describe('player match-side attribution', () => {
  const matchDate = new Date('2026-07-25T08:00:00Z');
  const membership = (
    competitionId: string,
    teamId: string,
    overrides: Partial<{
      status: 'ACTIVE' | 'REPLACED' | 'WITHDRAWN';
      validFrom: Date;
      validTo: Date | null;
    }> = {},
  ) => ({
    status: 'ACTIVE' as const,
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validTo: null,
    editionEntry: { competitionId, teamId },
    ...overrides,
  });

  it('uses the edition roster instead of a reused player club identity', () => {
    const player = {
      teamId: 'nsw-swifts',
      rosterMemberships: [
        membership('ssn-2026', 'nsw-swifts'),
        membership('glasgow-2026', 'australia'),
      ],
    };

    expect(playerTeamIdForMatch(
      player,
      'glasgow-2026',
      ['australia', 'england'],
      matchDate,
    )).toBe('australia');
  });

  it('fails closed when no unique match-side roster membership exists', () => {
    expect(playerTeamIdForMatch(
      { rosterMemberships: [] },
      'glasgow-2026',
      ['australia', 'england'],
      matchDate,
    )).toBeNull();
  });

  it('uses a replaced membership that was valid when a historical match was played', () => {
    expect(playerTeamIdForMatch({
      teamId: 'club-team',
      rosterMemberships: [membership('glasgow-2026', 'australia', {
        status: 'REPLACED',
        validTo: new Date('2026-07-26T00:00:00Z'),
      })],
    }, 'glasgow-2026', ['australia', 'england'], matchDate)).toBe('australia');
  });

  it('accepts a unique roster backfill created after a historical match', () => {
    expect(playerTeamIdForMatch({
      teamId: 'club-team',
      rosterMemberships: [membership('glasgow-2026', 'australia', {
        validFrom: new Date('2026-08-10T00:00:00Z'),
      })],
    }, 'glasgow-2026', ['australia', 'england'], matchDate)).toBe('australia');
  });

  it('does not revive an expired membership or guess across two sides', () => {
    expect(playerTeamIdForMatch({
      teamId: 'club-team',
      rosterMemberships: [membership('glasgow-2026', 'australia', {
        status: 'WITHDRAWN',
        validTo: new Date('2026-07-20T00:00:00Z'),
      })],
    }, 'glasgow-2026', ['australia', 'england'], matchDate)).toBeNull();
  });

  it('keeps a historically effective replaced player on a completed-match roster', () => {
    const historical = {
      status: 'REPLACED' as const,
      validFrom: new Date('2026-07-01T00:00:00Z'),
      validTo: new Date('2026-07-26T00:00:00Z'),
      player: { id: 'historical-player' },
    };

    expect(rosterForMatch([historical], matchDate, false)).toEqual([historical]);
  });

  it('uses only an active currently effective membership for a live roster', () => {
    const active = {
      status: 'ACTIVE' as const,
      validFrom: new Date('2026-07-01T00:00:00Z'),
      validTo: null,
      player: { id: 'active-player' },
    };
    const replaced = {
      status: 'REPLACED' as const,
      validFrom: new Date('2026-07-01T00:00:00Z'),
      validTo: null,
      player: { id: 'replaced-player' },
    };

    expect(rosterForMatch(
      [active, replaced],
      matchDate,
      true,
      new Date('2026-07-25T09:00:00Z'),
    )).toEqual([active]);
  });
});
