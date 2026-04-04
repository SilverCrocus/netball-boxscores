import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import HomePage from '../page';

vi.mock('@/lib/db', () => ({
  excludeSimData: {},
  prisma: {
    match: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: '1',
          status: 'LIVE',
          homeScore: 42,
          awayScore: 38,
          currentQuarter: 3,
          currentTime: '04:12',
          round: 12,
          venue: 'Arena',
          scheduledAt: new Date(),
          homeTeam: { name: 'Marlins', abbreviation: 'MAR', logoUrl: null },
          awayTeam: { name: 'Inferno', abbreviation: 'INF', logoUrl: null },
        },
        {
          id: '2',
          status: 'SCHEDULED',
          homeScore: 0,
          awayScore: 0,
          currentQuarter: null,
          currentTime: null,
          round: 12,
          venue: 'Stadium',
          scheduledAt: new Date(Date.now() + 86400000),
          homeTeam: { name: 'Wolves', abbreviation: 'WOL', logoUrl: null },
          awayTeam: { name: 'Harbor', abbreviation: 'HAR', logoUrl: null },
        },
        {
          id: '5',
          status: 'SCHEDULED',
          homeScore: 0,
          awayScore: 0,
          currentQuarter: null,
          currentTime: null,
          round: 13,
          venue: 'Dome',
          scheduledAt: new Date(Date.now() + 172800000),
          homeTeam: { name: 'Titans', abbreviation: 'TIT', logoUrl: null },
          awayTeam: { name: 'Rockets', abbreviation: 'ROC', logoUrl: null },
        },
        {
          id: '3',
          status: 'COMPLETED',
          homeScore: 64,
          awayScore: 58,
          currentQuarter: null,
          currentTime: null,
          round: 5,
          venue: 'RAC Arena',
          scheduledAt: new Date('2026-04-05T05:00:00Z'),
          homeTeam: { name: 'Vixens', abbreviation: 'VIX', logoUrl: null },
          awayTeam: { name: 'Fever', abbreviation: 'FEV', logoUrl: null },
        },
        {
          id: '4',
          status: 'COMPLETED',
          homeScore: 71,
          awayScore: 65,
          currentQuarter: null,
          currentTime: null,
          round: 4,
          venue: 'USC Stadium',
          scheduledAt: new Date('2026-03-29T03:00:00Z'),
          homeTeam: { name: 'Swifts', abbreviation: 'SWI', logoUrl: null },
          awayTeam: { name: 'Lightning', abbreviation: 'LIG', logoUrl: null },
        },
      ]),
    },
  },
}));

describe('HomePage', () => {
  it('renders TODAY\'S PULSE heading', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText("TODAY'S PULSE")).toBeInTheDocument();
  });

  it('renders LIVE ACTION section when live matches exist', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText('LIVE ACTION')).toBeInTheDocument();
  });

  it('renders UPCOMING FIXTURES section', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText('UPCOMING FIXTURES')).toBeInTheDocument();
  });

  it('renders "Next Match" label instead of "Match of the Day"', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText('Next Match')).toBeInTheDocument();
    expect(screen.queryByText('Match of the Day')).not.toBeInTheDocument();
  });

  it('renders full team names in side fixtures', async () => {
    const page = await HomePage();
    render(page);
    // Second scheduled match appears in side fixtures with full names
    expect(screen.getByText(/Titans v Rockets/)).toBeInTheDocument();
    expect(screen.queryByText(/TIT v ROC/)).not.toBeInTheDocument();
  });

  it('renders RESULTS section with round headings', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText('RESULTS')).toBeInTheDocument();
    expect(screen.getByText('Round 5')).toBeInTheDocument();
    expect(screen.getByText('Round 4')).toBeInTheDocument();
  });

  it('renders results grouped by round in descending order', async () => {
    const page = await HomePage();
    render(page);
    const round5 = screen.getByText('Round 5');
    const round4 = screen.getByText('Round 4');
    // Round 5 should appear before Round 4 in the DOM
    expect(round5.compareDocumentPosition(round4) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not show Final badge in results', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.queryByText('Final')).not.toBeInTheDocument();
  });
});
