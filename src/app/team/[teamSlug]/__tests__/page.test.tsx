import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TeamPage from '../page';

vi.mock('@/lib/db', () => ({
  prisma: {
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
    expect(screen.getByText('vs Titans')).toBeInTheDocument();
  });

  it('renders standing stats', async () => {
    const page = await TeamPage({ params: Promise.resolve({ teamSlug: 'vipers-athletics' }) });
    render(page);
    expect(screen.getByText('11-1-0')).toBeInTheDocument();
    expect(screen.getByText('44')).toBeInTheDocument();
  });
});
