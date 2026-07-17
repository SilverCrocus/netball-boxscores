import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFollowsMock,
  findMatchesMock,
  requireAuthMock,
  resolvePublicMatchMock,
} = vi.hoisted(() => ({
  findFollowsMock: vi.fn(),
  findMatchesMock: vi.fn(),
  requireAuthMock: vi.fn(),
  resolvePublicMatchMock: vi.fn(),
}));
vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccess: resolvePublicMatchMock,
  canExposePublicMatchScore: (access: { scoreAvailable: boolean }) => access.scoreAvailable,
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
  id: 'match-1', competitionId: 'competition-2026', status: 'COMPLETED', scheduledAt: new Date('2026-06-01T04:00:00Z'),
  resultQuality: 'OFFICIAL_FINAL',
  homeScore: 62, awayScore: 58, venue: 'Arena', round: 10, finalCode: null,
  roundLabel: null, stage: null,
  currentQuarter: null, currentTime: null, homeTeamId: 'team-1', awayTeamId: 'team-2',
  homeTeam: { name: 'Vipers', abbreviation: 'VIP', logoUrl: null },
  awayTeam: { name: 'Stars', abbreviation: 'STA', logoUrl: null },
  competition: { dataCoverage: [{ capability: 'FINAL_SCORE', state: 'AVAILABLE' }] },
  dataCoverage: [],
  teamStats: [],
};

describe('GET /api/user/home', () => {
  beforeEach(() => {
    requireAuthMock.mockReset().mockResolvedValue({ user: { id: 'user-1' }, error: null });
    findFollowsMock.mockReset().mockResolvedValue([{ teamId: 'team-1', team }]);
    findMatchesMock.mockReset().mockImplementation(({ where }: { where: { status: string } }) =>
      Promise.resolve(where.status === 'COMPLETED' ? [match] : []),
    );
    resolvePublicMatchMock.mockReset().mockResolvedValue({
      status: 'COMPLETED',
      scoreAvailable: true,
      features: { superShots: { available: true } },
    });
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
    expect(findMatchesMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'COMPLETED',
        AND: expect.arrayContaining([{
          OR: [
            { stageId: null },
            { stage: { is: { isPublished: true } } },
          ],
        }]),
      }),
    }));
  });

  it('removes score, clock, and super-shot details when current access denies them', async () => {
    findMatchesMock.mockImplementation(({ where }: { where: { status: string } }) =>
      Promise.resolve(where.status === 'COMPLETED' ? [{
        ...match,
        currentQuarter: 4,
        currentTime: '0',
        teamStats: [
          { teamId: 'team-1', goals: 60, goal2: 2 },
          { teamId: 'team-2', goals: 58, goal2: 0 },
        ],
      }] : []),
    );
    resolvePublicMatchMock.mockResolvedValue({
      status: 'COMPLETED',
      scoreAvailable: false,
      features: { superShots: { available: false } },
    });

    const response = await GET();
    const payload = await response.json();

    expect(payload[0].latestResult).toMatchObject({
      scoreAvailable: false,
      homeScore: null,
      awayScore: null,
      currentQuarter: null,
      currentTime: null,
      homeBreakdown: null,
      awayBreakdown: null,
    });
  });

  it('avoids match queries when the user follows no teams', async () => {
    findFollowsMock.mockResolvedValue([]);

    const response = await GET();

    expect(await response.json()).toEqual([]);
    expect(findMatchesMock).not.toHaveBeenCalled();
  });
});
