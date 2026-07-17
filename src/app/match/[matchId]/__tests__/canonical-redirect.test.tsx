import { describe, expect, it, vi } from 'vitest';

const { redirectMock, resolvePublicMatchMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((href: string) => {
    throw new Error(`REDIRECT:${href}`);
  }),
  resolvePublicMatchMock: vi.fn().mockResolvedValue({ id: 'ssn-match-1' }),
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
        id: 'ssn-match-1',
        competitionId: 'ssn-2026',
        homeTeamId: 'vixens',
        awayTeamId: 'fever',
        homeTeam: { id: 'vixens' },
        awayTeam: { id: 'fever' },
      }),
    },
  },
}));
vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchForRequest: resolvePublicMatchMock,
}));

import MatchPage from '../page';

describe('match canonical edition redirect', () => {
  it('replaces a stale Glasgow context with the match owning SSN edition', async () => {
    await expect(MatchPage({
      params: Promise.resolve({ matchId: 'ssn-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    })).rejects.toThrow('REDIRECT:/match/ssn-match-1?edition=ssn-2026');
  });
});
