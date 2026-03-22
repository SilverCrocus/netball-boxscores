import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MatchPage from '../page';

vi.mock('@/lib/db', () => ({
  prisma: {
    match: {
      findUnique: vi.fn().mockResolvedValue({
        id: '1',
        status: 'COMPLETED',
        homeScore: 64,
        awayScore: 58,
        currentQuarter: null,
        currentTime: null,
        round: 12,
        venue: 'Stadium Arena',
        scheduledAt: new Date(),
        homeTeamId: 'home-team',
        awayTeamId: 'away-team',
        homeTeam: { name: 'Thunder', abbreviation: 'THU', logoUrl: null, slug: 'thunder' },
        awayTeam: { name: 'Lightning', abbreviation: 'LIG', logoUrl: null, slug: 'lightning' },
        quarters: [
          { quarter: 1, homeScore: 16, awayScore: 14 },
          { quarter: 2, homeScore: 12, awayScore: 18 },
          { quarter: 3, homeScore: 20, awayScore: 12 },
          { quarter: 4, homeScore: 16, awayScore: 14 },
        ],
        playerStats: [
          {
            id: 'ps1',
            player: { id: 'p1', name: 'Elena Rodriguez', position: 'GS', photoUrl: null, teamId: 'home-team' },
            goals: 42, attempts: 45, goalAssists: 0, intercepts: 0,
            deflections: 1, rebounds: 4, penalties: 0, feeds: 2,
            centrePassReceives: 0, turnovers: 1, minutesPlayed: 60,
          },
        ],
        scoreFlow: [
          { period: 1, homeScore: 1, awayScore: 0 },
          { period: 1, homeScore: 2, awayScore: 1 },
        ],
      }),
    },
  },
}));

describe('MatchPage', () => {
  it('renders team names in hero', async () => {
    const page = await MatchPage({ params: Promise.resolve({ matchId: '1' }) });
    render(page);
    expect(screen.getAllByText(/Thunder/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Lightning/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders final score', async () => {
    const page = await MatchPage({ params: Promise.resolve({ matchId: '1' }) });
    render(page);
    expect(screen.getByText('64')).toBeInTheDocument();
    expect(screen.getByText('58')).toBeInTheDocument();
  });

  it('renders player stats table', async () => {
    const page = await MatchPage({ params: Promise.resolve({ matchId: '1' }) });
    render(page);
    expect(screen.getAllByText('Elena Rodriguez').length).toBeGreaterThanOrEqual(1);
  });
});
