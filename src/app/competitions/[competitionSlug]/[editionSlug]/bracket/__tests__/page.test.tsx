import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BracketPage from '../page';

const mocks = vi.hoisted(() => ({
  resolveEdition: vi.fn(),
  getTournamentBracket: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/competitions', () => ({
  resolveEdition: mocks.resolveEdition,
}));

vi.mock('@/lib/tournament', () => ({
  getTournamentBracket: mocks.getTournamentBracket,
}));

describe('BracketPage', () => {
  it('reuses the resolved public edition for bracket access checks', async () => {
    const edition = {
      id: 'glasgow-2026',
      season: 2026,
      label: 'Glasgow 2026',
      name: 'Commonwealth Games Netball',
      slug: 'glasgow-2026',
      sourceTimezone: 'Europe/London',
      series: {
        id: 'commonwealth-games-netball',
        slug: 'commonwealth-games-netball',
        name: 'Commonwealth Games Netball',
        kind: 'TOURNAMENT',
      },
    };
    mocks.resolveEdition.mockResolvedValue({ edition, editions: [edition] });
    mocks.getTournamentBracket.mockResolvedValue([{
      id: 'semi-finals',
      slug: 'semi-finals',
      name: 'Semi-finals',
      type: 'SEMI_FINALS',
      sequence: 1,
      matches: [{
        id: 'semi-final-1',
        label: 'Semi-final 1',
        scheduledAt: '2026-08-01T08:00:00.000Z',
        venue: 'The Hydro',
        status: 'SCHEDULED',
        sideA: { side: 'A', label: 'Qualifier A', resolved: false, team: null, score: null },
        sideB: { side: 'B', label: 'Qualifier B', resolved: false, team: null, score: null },
      }],
    }]);

    const page = await BracketPage({
      params: Promise.resolve({
        competitionSlug: 'commonwealth-games-netball',
        editionSlug: 'glasgow-2026',
      }),
    });
    render(page);

    expect(mocks.getTournamentBracket).toHaveBeenCalledOnce();
    expect(mocks.getTournamentBracket).toHaveBeenCalledWith('glasgow-2026', edition);
    expect(screen.getByText('Times shown in Sydney time')).toBeInTheDocument();
    expect(screen.getByText(/6:00 pm AEST/)).toBeInTheDocument();
  });
});
