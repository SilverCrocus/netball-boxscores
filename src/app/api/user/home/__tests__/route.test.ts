import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFollowsMock, findMatchesMock, requireAuthMock } = vi.hoisted(() => ({
  findFollowsMock: vi.fn(),
  findMatchesMock: vi.fn(),
  requireAuthMock: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/competitions', () => ({
  resolveCompetition: vi.fn().mockResolvedValue({ competition: { id: 'competition-2026' } }),
}));
vi.mock('@/lib/db', () => ({
  excludeSimData: {},
  prisma: {
    userTeam: { findMany: findFollowsMock },
    match: { findMany: findMatchesMock },
  },
}));

import { GET } from '../route';

const team = { id: 'team-1', name: 'Vipers', abbreviation: 'VIP', logoUrl: null, primaryColor: null };
const match = {
  id: 'match-1', status: 'COMPLETED', scheduledAt: new Date('2026-06-01T04:00:00Z'),
  homeScore: 62, awayScore: 58, venue: 'Arena', round: 10, finalCode: null,
  currentQuarter: null, currentTime: null, homeTeamId: 'team-1', awayTeamId: 'team-2',
  homeTeam: { name: 'Vipers', abbreviation: 'VIP', logoUrl: null },
  awayTeam: { name: 'Stars', abbreviation: 'STA', logoUrl: null }, teamStats: [],
};

describe('GET /api/user/home', () => {
  beforeEach(() => {
    requireAuthMock.mockReset().mockResolvedValue({ user: { id: 'user-1' }, error: null });
    findFollowsMock.mockReset().mockResolvedValue([{ teamId: 'team-1', team }]);
    findMatchesMock.mockReset().mockImplementation(({ where }: { where: { status: string } }) =>
      Promise.resolve(where.status === 'COMPLETED' ? [match] : []),
    );
  });

  it('returns private followed-team fixtures and results', async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(payload).toMatchObject([{
      team: { id: 'team-1' },
      nextMatch: null,
      latestResult: { id: 'match-1', scheduledAt: '2026-06-01T04:00:00.000Z' },
    }]);
  });

  it('avoids match queries when the user follows no teams', async () => {
    findFollowsMock.mockResolvedValue([]);

    const response = await GET();

    expect(await response.json()).toEqual([]);
    expect(findMatchesMock).not.toHaveBeenCalled();
  });
});
