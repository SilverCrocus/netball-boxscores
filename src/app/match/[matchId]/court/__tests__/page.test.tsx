import { describe, expect, it, vi } from 'vitest';

const { redirectMock } = vi.hoisted(() => ({
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
      findUnique: vi.fn().mockResolvedValue({
        id: 'glasgow-match-1',
        competitionId: 'glasgow-2026',
        status: 'SCHEDULED',
        homeTeamId: 'australia',
        awayTeamId: 'england',
        homeTeam: { id: 'australia' },
        awayTeam: { id: 'england' },
        competition: { dataCoverage: [] },
        dataCoverage: [],
      }),
    },
  },
}));

import CourtPage from '../page';

describe('court route safety', () => {
  it('returns an unsupported scheduled fixture to its canonical match page', async () => {
    await expect(CourtPage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    })).rejects.toThrow('REDIRECT:/match/glasgow-match-1?edition=glasgow-2026');
  });
});
