import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUniqueMock, redirectMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  redirectMock: vi.fn((href: string) => {
    throw new Error(`REDIRECT:${href}`);
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirect: redirectMock,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    match: {
      findUnique: findUniqueMock,
    },
  },
}));
vi.mock('@/lib/win-probability', () => ({
  computeTeamStrengthPrior: vi.fn().mockResolvedValue(null),
}));
vi.mock('../LiveGameClient', () => ({
  LiveGameClient: ({ match }: { match: { homeTeam: { players: Array<{ name: string }> }; awayTeam: { players: Array<{ name: string }> } } }) => (
    <div>{[...match.homeTeam.players, ...match.awayTeam.players].map((player) => player.name).join(', ')}</div>
  ),
}));

import LiveGamePage from '../page';

const scheduledMatch = {
        id: 'glasgow-match-1',
        competitionId: 'glasgow-2026',
        status: 'SCHEDULED',
        homeTeamId: 'australia',
        awayTeamId: 'england',
        homeTeam: { id: 'australia' },
        awayTeam: { id: 'england' },
        competition: { dataCoverage: [] },
        dataCoverage: [],
};

describe('live match route safety', () => {
  beforeEach(() => {
    findUniqueMock.mockReset().mockResolvedValue(scheduledMatch);
    redirectMock.mockClear();
  });

  it('returns an unsupported scheduled fixture to its canonical match page', async () => {
    await expect(LiveGamePage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    })).rejects.toThrow('REDIRECT:/match/glasgow-match-1?edition=glasgow-2026');
  });

  it('builds national-team lineups from the edition roster, not the player club team', async () => {
    findUniqueMock.mockResolvedValue({
      ...scheduledMatch,
      status: 'LIVE',
      scheduledAt: new Date('2026-07-25T08:00:00Z'),
      round: null,
      roundLabel: 'Pool A · Day 1',
      finalCode: null,
      venue: 'SEC Centre',
      homeScore: 10,
      awayScore: 8,
      currentQuarter: 1,
      currentTime: '05:00',
      stage: { name: 'Pool Stage' },
      competition: {
        dataCoverage: [
          { capability: 'FINAL_SCORE', state: 'AVAILABLE' },
          { capability: 'PLAYER_BOX_SCORE', state: 'AVAILABLE' },
          { capability: 'LINEUPS', state: 'AVAILABLE' },
        ],
      },
      homeTeam: {
        id: 'australia', name: 'Australia', abbreviation: 'AUS', logoUrl: null, primaryColor: null,
        editionEntries: [{
          competitionId: 'glasgow-2026',
          roster: [{
            validFrom: new Date('2026-07-01T00:00:00Z'), validTo: null, designatedPosition: 'GA',
            player: {
              id: 'player-1', name: 'Shared Player', position: 'C', teamId: 'nsw-swifts',
              matchStats: [{ goals: 4 }],
            },
          }],
        }],
      },
      awayTeam: {
        id: 'england', name: 'England', abbreviation: 'ENG', logoUrl: null, primaryColor: null,
        editionEntries: [{ competitionId: 'glasgow-2026', roster: [] }],
      },
      quarters: [],
      scoreFlow: [],
      matchEvents: [],
    });

    render(await LiveGamePage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    }));

    expect(screen.getByText('Shared Player')).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
