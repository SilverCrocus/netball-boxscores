import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import StandingsPage from '../page';

vi.mock('@/lib/db', () => ({
  prisma: {
    standing: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: '1',
          rank: 1,
          played: 12,
          wins: 11,
          losses: 1,
          draws: 0,
          goalsFor: 645,
          goalsAgainst: 412,
          goalPercentage: 156.5,
          points: 44,
          team: { name: 'Vipers Athletics', slug: 'vipers-athletics', abbreviation: 'VIP', logoUrl: null },
        },
        {
          id: '2',
          rank: 2,
          played: 12,
          wins: 10,
          losses: 2,
          draws: 0,
          goalsFor: 598,
          goalsAgainst: 480,
          goalPercentage: 124.5,
          points: 40,
          team: { name: 'Starlight Gems', slug: 'starlight-gems', abbreviation: 'STA', logoUrl: null },
        },
      ]),
    },
  },
}));

describe('StandingsPage', () => {
  it('renders standings heading', async () => {
    const page = await StandingsPage();
    render(page);
    expect(screen.getByText(/Standings/i)).toBeInTheDocument();
  });

  it('renders team names', async () => {
    const page = await StandingsPage();
    render(page);
    expect(screen.getByText('Vipers Athletics')).toBeInTheDocument();
    expect(screen.getByText('Starlight Gems')).toBeInTheDocument();
  });

  it('renders column headers', async () => {
    const page = await StandingsPage();
    render(page);
    expect(screen.getByText('GP')).toBeInTheDocument();
    expect(screen.getByText('Pts')).toBeInTheDocument();
  });

  it('renders points values', async () => {
    const page = await StandingsPage();
    render(page);
    expect(screen.getByText('44')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
  });
});
