import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import MatchPage from '../page';

const { resolvePublicMatchMock, notFoundMock } = vi.hoisted(() => ({
  resolvePublicMatchMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

const availableFeature = (capability: string) => ({
  capability,
  state: 'AVAILABLE',
  scope: 'edition',
  available: true,
});

const publicAccess = {
  id: '1',
  competitionId: 'ssn-2026',
  status: 'COMPLETED',
  resultQuality: 'OFFICIAL_FINAL',
  scheduledAt: new Date('2026-05-01T08:00:00Z'),
  homeTeamId: 'home-team',
  awayTeamId: 'away-team',
  features: {
    finalScore: availableFeature('FINAL_SCORE'),
    periodScores: availableFeature('PERIOD_SCORES'),
    teamBoxScore: availableFeature('TEAM_BOX_SCORE'),
    playerBoxScore: availableFeature('PLAYER_BOX_SCORE'),
    netPoints: availableFeature('NET_POINTS'),
    matchEvents: availableFeature('MATCH_EVENTS'),
    scoreFlow: availableFeature('SCORE_FLOW'),
    superShots: availableFeature('SUPER_SHOTS'),
    lineups: availableFeature('LINEUPS'),
  },
};

vi.mock('@/components/match/MatchActions', () => ({ MatchActions: () => null }));

vi.mock('@/lib/public-match', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/public-match')>();
  return { ...actual, resolvePublicMatchForRequest: resolvePublicMatchMock };
});

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
  redirect: vi.fn((href: string) => {
    throw new Error(`REDIRECT:${href}`);
  }),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    match: {
      findUnique: vi.fn().mockResolvedValue({
        id: '1',
        competitionId: 'ssn-2026',
        status: 'COMPLETED',
        resultQuality: 'OFFICIAL_FINAL',
        homeScore: 64,
        awayScore: 58,
        currentQuarter: null,
        currentTime: null,
        round: 12,
        venue: 'Stadium Arena',
        scheduledAt: new Date('2026-05-01T08:00:00Z'),
        homeTeamId: 'home-team',
        awayTeamId: 'away-team',
        homeTeam: { name: 'Thunder', abbreviation: 'THU', logoUrl: null, slug: 'thunder' },
        awayTeam: { name: 'Lightning', abbreviation: 'LIG', logoUrl: null, slug: 'lightning' },
        competition: {
          dataCoverage: [
            { capability: 'FINAL_SCORE', state: 'AVAILABLE' },
            { capability: 'PERIOD_SCORES', state: 'AVAILABLE' },
            { capability: 'PLAYER_BOX_SCORE', state: 'AVAILABLE' },
            { capability: 'SCORE_FLOW', state: 'AVAILABLE' },
            { capability: 'MATCH_EVENTS', state: 'AVAILABLE' },
            { capability: 'NET_POINTS', state: 'AVAILABLE' },
            { capability: 'SUPER_SHOTS', state: 'AVAILABLE' },
          ],
        },
        dataCoverage: [],
        quarters: [
          { quarter: 1, homeScore: 16, awayScore: 14 },
          { quarter: 2, homeScore: 12, awayScore: 18 },
          { quarter: 3, homeScore: 20, awayScore: 12 },
          { quarter: 4, homeScore: 16, awayScore: 14 },
        ],
        playerStats: [
          {
            id: 'ps1',
            player: {
              id: 'p1', name: 'Elena Rodriguez', position: 'GS', photoUrl: null, teamId: 'home-team',
              rosterMemberships: [{
                status: 'ACTIVE',
                validFrom: new Date('2026-01-01T00:00:00Z'),
                validTo: null,
                editionEntry: { competitionId: 'ssn-2026', teamId: 'home-team' },
              }],
            },
            goals: 42, attempts: 45, goalAssists: 0, intercepts: 0,
            deflections: 1, rebounds: 4, penalties: 0, feeds: 2,
            centrePassReceives: 0, turnovers: 1, minutesPlayed: 60, netPoints: 55, gain: 1,
          },
          {
            id: 'ps2',
            player: {
              id: 'p2', name: 'Jade Clarke', position: 'C', photoUrl: null, teamId: 'away-team',
              rosterMemberships: [{
                status: 'ACTIVE',
                validFrom: new Date('2026-01-01T00:00:00Z'),
                validTo: null,
                editionEntry: { competitionId: 'ssn-2026', teamId: 'away-team' },
              }],
            },
            goals: 2, attempts: 2, goalAssists: 20, intercepts: 4,
            deflections: 6, rebounds: 1, penalties: 3, feeds: 35,
            centrePassReceives: 18, turnovers: 2, minutesPlayed: 60, netPoints: 96, gain: 4,
          },
        ],
        scoreFlow: [
          { id: 'sf1', period: 1, periodSeconds: 10, scoringTeamId: 'home-team', homeScore: 1, awayScore: 0, scorePoints: 1, scorerPlayerId: 'p1' },
          { id: 'sf2', period: 1, periodSeconds: 20, scoringTeamId: 'away-team', homeScore: 2, awayScore: 1, scorePoints: 1, scorerPlayerId: 'p2' },
        ],
        _count: { matchEvents: 0 },
      }),
    },
  },
}));

describe('MatchPage', () => {
  beforeEach(() => {
    resolvePublicMatchMock.mockReset().mockResolvedValue(publicAccess);
    notFoundMock.mockClear();
  });

  it('renders team names in hero', async () => {
    const page = await MatchPage({ params: Promise.resolve({ matchId: '1' }), searchParams: Promise.resolve({ edition: 'ssn-2026' }) });
    render(page);
    expect(screen.getAllByText(/Thunder/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Lightning/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders final score', async () => {
    const page = await MatchPage({ params: Promise.resolve({ matchId: '1' }), searchParams: Promise.resolve({ edition: 'ssn-2026' }) });
    render(page);
    expect(screen.getByText('64')).toBeInTheDocument();
    expect(screen.getByText('58')).toBeInTheDocument();
  });

  it('renders player stats table', async () => {
    const page = await MatchPage({ params: Promise.resolve({ matchId: '1' }), searchParams: Promise.resolve({ edition: 'ssn-2026' }) });
    render(page);
    expect(screen.getAllByText('Elena Rodriguez').length).toBeGreaterThanOrEqual(1);
  });

  it('uses the match canonical edition for every rendered player profile link', async () => {
    const page = await MatchPage({ params: Promise.resolve({ matchId: '1' }), searchParams: Promise.resolve({ edition: 'ssn-2026' }) });
    render(page);

    expect(screen.getByRole('link', { name: 'Elena Rodriguez' })).toHaveAttribute(
      'href',
      '/player/p1?edition=ssn-2026',
    );
    for (const link of screen.getAllByRole('link', { name: 'Jade Clarke' })) {
      expect(link).toHaveAttribute('href', '/player/p2?edition=ssn-2026');
    }
  });

  it('labels the top player as a NetPoints leader rather than an official MVP', async () => {
    const page = await MatchPage({ params: Promise.resolve({ matchId: '1' }), searchParams: Promise.resolve({ edition: 'ssn-2026' }) });
    render(page);
    const mvpCard = screen.getByText('Top NetPoints').parentElement?.parentElement;

    expect(mvpCard).not.toBeNull();
    expect(within(mvpCard!).getByText('Jade Clarke')).toBeInTheDocument();
    expect(within(mvpCard!).getByText('96')).toBeInTheDocument();
    expect(within(mvpCard!).getByText('Goal Ast')).toBeInTheDocument();
    expect(within(mvpCard!).getByText('Feeds')).toBeInTheDocument();
    expect(screen.queryByText('Match MVP')).not.toBeInTheDocument();
  });

  it('uses an explicit initial payload and excludes match events', async () => {
    const { prisma } = await import('@/lib/db');
    await MatchPage({ params: Promise.resolve({ matchId: '1' }), searchParams: Promise.resolve({ edition: 'ssn-2026' }) });

    const query = vi.mocked(prisma.match.findUnique).mock.calls.at(-1)?.[0];
    expect(query?.select).not.toHaveProperty('matchEvents');
    expect(query?.select).toEqual(expect.objectContaining({
      competitionId: true,
      _count: { select: { matchEvents: true } },
      playerStats: expect.objectContaining({
        select: expect.objectContaining({ player: expect.any(Object) }),
      }),
    }));
  });

  it('returns not found when the shared public gate denies the match', async () => {
    resolvePublicMatchMock.mockResolvedValueOnce(null);

    await expect(MatchPage({
      params: Promise.resolve({ matchId: '1' }),
      searchParams: Promise.resolve({ edition: 'ssn-2026' }),
    })).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFoundMock).toHaveBeenCalledOnce();
  });
});
