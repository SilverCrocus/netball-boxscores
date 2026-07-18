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
    mocks.getTournamentBracket.mockResolvedValue([]);

    await BracketPage({
      params: Promise.resolve({
        competitionSlug: 'commonwealth-games-netball',
        editionSlug: 'glasgow-2026',
      }),
    });

    expect(mocks.getTournamentBracket).toHaveBeenCalledOnce();
    expect(mocks.getTournamentBracket).toHaveBeenCalledWith('glasgow-2026', edition);
  });
});
