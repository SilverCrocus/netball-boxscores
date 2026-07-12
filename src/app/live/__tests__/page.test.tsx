import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirstMock, findManyMock, getLiveStateMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  getLiveStateMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/live-state', () => ({ getLiveState: getLiveStateMock }));
vi.mock('@/lib/competitions', () => ({
  resolveCompetition: vi.fn().mockResolvedValue({ competition: { id: 'competition-2026' } }),
}));
vi.mock('@/lib/db', () => ({
  excludeSimData: { isSimulated: false },
  prisma: {
    match: { findFirst: findFirstMock, findMany: findManyMock },
  },
}));
vi.mock('@/components/ui/ScoreCard', () => ({
  ScoreCard: ({ match }: { match: { id: string } }) => <div>Card {match.id}</div>,
}));

import LivePage from '../page';

const fixture = {
  id: 'next-match',
  status: 'SCHEDULED',
  scheduledAt: new Date('2026-07-20T04:00:00Z'),
  homeScore: 0,
  awayScore: 0,
  venue: 'Arena',
  round: 14,
  finalCode: null,
  currentQuarter: null,
  currentTime: null,
  homeTeamId: 'home',
  awayTeamId: 'away',
  homeTeam: { name: 'Vipers', abbreviation: 'VIP', logoUrl: null },
  awayTeam: { name: 'Stars', abbreviation: 'STA', logoUrl: null },
  teamStats: [],
};

describe('LivePage', () => {
  beforeEach(() => {
    getLiveStateMock.mockReset();
    findFirstMock.mockReset();
    findManyMock.mockReset();
  });

  it('renders a useful hub when no match is live', async () => {
    getLiveStateMock.mockResolvedValue({ liveMatchIds: [] });
    findFirstMock.mockImplementation(({ where }: { where: { status: string } }) =>
      Promise.resolve(where.status === 'SCHEDULED' ? fixture : { ...fixture, id: 'latest-result', status: 'COMPLETED' }),
    );

    render(await LivePage());

    expect(screen.getByRole('heading', { name: 'No match is live right now' })).toBeInTheDocument();
    expect(screen.getByText('Card next-match')).toBeInTheDocument();
    expect(screen.getByText('Card latest-result')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all fixtures' })).toHaveAttribute('href', '/');
  });

  it('offers a chooser when several matches are live', async () => {
    getLiveStateMock.mockResolvedValue({ liveMatchIds: ['live-1', 'live-2'] });
    findManyMock.mockResolvedValue([
      { ...fixture, id: 'live-1', status: 'LIVE' },
      { ...fixture, id: 'live-2', status: 'LIVE' },
    ]);

    render(await LivePage());

    expect(screen.getByRole('heading', { name: 'Choose a live match' })).toBeInTheDocument();
    expect(screen.getByText('Card live-1')).toBeInTheDocument();
    expect(screen.getByText('Card live-2')).toBeInTheDocument();
  });
});
