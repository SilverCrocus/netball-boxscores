import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TeamPage from '../page';

vi.mock('@/lib/db', () => ({
  excludeSimData: {},
  prisma: {
    competition: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'competition-2026',
          season: 2026,
          name: 'Suncorp Super Netball',
          seasonStart: new Date('2026-03-01T00:00:00Z'),
          seasonEnd: new Date('2026-07-31T00:00:00Z'),
        },
      ]),
    },
    standing: {
      findUnique: vi.fn().mockResolvedValue({
        rank: 1,
        played: 12,
        wins: 11,
        losses: 1,
        draws: 0,
        goalsFor: 645,
        goalsAgainst: 412,
        goalPercentage: 156.5,
        points: 44,
      }),
    },
    team: {
      findUnique: vi.fn().mockResolvedValue({
        id: 't1',
        name: 'Vipers Athletics',
        slug: 'vipers-athletics',
        abbreviation: 'VIP',
        logoUrl: null,
        players: [
          { id: 'p1', name: 'Maya Sterling', position: 'GS', photoUrl: null },
          { id: 'p2', name: 'Elena Rodriguez', position: 'GA', photoUrl: null },
        ],
        standings: [
          { rank: 1, played: 12, wins: 11, losses: 1, draws: 0, goalsFor: 645, goalsAgainst: 412, goalPercentage: 156.5, points: 44 },
        ],
        homeMatches: [
          { id: 'm1', status: 'COMPLETED', homeScore: 62, awayScore: 44, scheduledAt: new Date(), round: 10, venue: 'Arena', awayTeam: { name: 'Titans', abbreviation: 'TIT' } },
        ],
        awayMatches: [],
      }),
    },
    match: {
      findMany: vi.fn().mockImplementation(({ where }) => {
        if (where.status === 'COMPLETED') {
          return Promise.resolve([
            {
              id: 'm1', status: 'COMPLETED', homeTeamId: 't1', awayTeamId: 't2',
              homeScore: 62, awayScore: 44, scheduledAt: new Date('2026-06-01T04:00:00Z'),
              homeTeam: { name: 'Vipers Athletics', abbreviation: 'VIP', logoUrl: null },
              awayTeam: { name: 'Titans', abbreviation: 'TIT', logoUrl: null },
            },
            {
              id: 'm2', status: 'COMPLETED', homeTeamId: 't3', awayTeamId: 't1',
              homeScore: 50, awayScore: 50, scheduledAt: new Date('2026-05-25T04:00:00Z'),
              homeTeam: { name: 'Stars', abbreviation: 'STA', logoUrl: null },
              awayTeam: { name: 'Vipers Athletics', abbreviation: 'VIP', logoUrl: null },
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    },
  },
}));

describe('TeamPage', () => {
  it('renders team name', async () => {
    const page = await TeamPage({ params: Promise.resolve({ teamSlug: 'vipers-athletics' }) });
    render(page);
    expect(screen.getByText(/Vipers/)).toBeInTheDocument();
  });

  it('renders roster', async () => {
    const page = await TeamPage({ params: Promise.resolve({ teamSlug: 'vipers-athletics' }) });
    render(page);
    expect(screen.getByText('Maya Sterling')).toBeInTheDocument();
    expect(screen.getByText('Elena Rodriguez')).toBeInTheDocument();
  });

  it('renders ranking badge', async () => {
    const page = await TeamPage({ params: Promise.resolve({ teamSlug: 'vipers-athletics' }) });
    render(page);
    expect(screen.getByText(/Ranking #1/i)).toBeInTheDocument();
  });

  it('renders recent form section with win/loss', async () => {
    const page = await TeamPage({ params: Promise.resolve({ teamSlug: 'vipers-athletics' }) });
    render(page);
    expect(screen.getByText('Recent Form')).toBeInTheDocument();
    expect(screen.getByText('W')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.getByText('vs Titans')).toBeInTheDocument();
  });

  it('renders standing stats', async () => {
    const page = await TeamPage({ params: Promise.resolve({ teamSlug: 'vipers-athletics' }) });
    render(page);
    expect(screen.getByText('11-1-0')).toBeInTheDocument();
    expect(screen.getByText('44')).toBeInTheDocument();
  });

  it('queries recent and upcoming matches with independent ordering and limits', async () => {
    const { prisma } = await import('@/lib/db');
    await TeamPage({ params: Promise.resolve({ teamSlug: 'vipers-athletics' }) });

    expect(prisma.match.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        competitionId: 'competition-2026',
        status: 'COMPLETED',
      }),
      orderBy: { scheduledAt: 'desc' },
      take: 5,
    }));
    expect(prisma.match.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        competitionId: 'competition-2026',
        status: 'SCHEDULED',
        scheduledAt: { gte: expect.any(Date) },
      }),
      orderBy: { scheduledAt: 'asc' },
      take: 3,
    }));
    expect(prisma.standing.findUnique).toHaveBeenCalledWith({
      where: {
        competitionId_teamId: {
          competitionId: 'competition-2026',
          teamId: 't1',
        },
      },
    });
  });
});
