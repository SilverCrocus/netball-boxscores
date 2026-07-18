import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFollowsMock,
  findMatchesMock,
  findPublicTeamsMock,
  requireAuthMock,
  resolvePublicMatchBatchMock,
} = vi.hoisted(() => ({
  findFollowsMock: vi.fn(),
  findMatchesMock: vi.fn(),
  findPublicTeamsMock: vi.fn(),
  requireAuthMock: vi.fn(),
  resolvePublicMatchBatchMock: vi.fn(),
}));
vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccessBatch: resolvePublicMatchBatchMock,
  canExposePublicMatchScore: (access: { scoreAvailable: boolean }) => access.scoreAvailable,
}));

vi.mock('@/lib/api-auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/competitions', () => ({
  getPublicCompetitions: vi.fn().mockResolvedValue([{ id: 'competition-2026' }]),
  resolveCompetition: vi.fn().mockResolvedValue({ competition: { id: 'competition-2026' } }),
}));
vi.mock('@/lib/db', () => ({
  excludeSimData: {},
  prisma: {
    userTeam: { findMany: findFollowsMock },
    match: { findMany: findMatchesMock },
    team: { findMany: findPublicTeamsMock },
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
    findPublicTeamsMock.mockReset().mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) => (
        Promise.resolve(where.id.in.map((id) => ({ id })))
      ),
    );
    findMatchesMock.mockReset().mockImplementation(({ where }: { where: { status: string } }) =>
      Promise.resolve(where.status === 'COMPLETED' ? [match] : []),
    );
    resolvePublicMatchBatchMock.mockReset().mockResolvedValue(new Map([['match-1', {
      status: 'COMPLETED',
      scoreAvailable: true,
      features: { superShots: { available: true } },
    }]]));
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
    expect(findFollowsMock).toHaveBeenCalledWith(expect.objectContaining({
      take: 100,
      where: expect.objectContaining({
        userId: 'user-1',
        team: { is: { OR: expect.any(Array) } },
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
    resolvePublicMatchBatchMock.mockResolvedValue(new Map([['match-1', {
      status: 'COMPLETED',
      scoreAvailable: false,
      features: { superShots: { available: false } },
    }]]));

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

  it('does not serialize a stale association to a private team', async () => {
    findFollowsMock.mockResolvedValue([{
      teamId: 'private-team',
      team: { ...team, id: 'private-team', name: 'Private Draft Team' },
    }]);
    findPublicTeamsMock.mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
    expect(findMatchesMock).not.toHaveBeenCalled();
  });

  it('returns only public teams from mixed historical associations', async () => {
    findFollowsMock.mockResolvedValue([
      { teamId: 'team-1', team },
      {
        teamId: 'private-team',
        team: { ...team, id: 'private-team', name: 'Private Draft Team' },
      },
    ]);
    findPublicTeamsMock.mockResolvedValue([{ id: 'team-1' }]);
    findMatchesMock.mockResolvedValue([]);

    const response = await GET();
    const payload = await response.json();

    expect(payload).toEqual([expect.objectContaining({ team: expect.objectContaining({ id: 'team-1' }) })]);
    expect(JSON.stringify(payload)).not.toContain('private-team');
    expect(JSON.stringify(payload)).not.toContain('Private Draft Team');
  });

  it('bounds candidate and authorization queries to 100 followed teams', async () => {
    const candidates = Array.from({ length: 120 }, (_, index) => ({
      teamId: `team-${index}`,
      team: { ...team, id: `team-${index}`, name: `Team ${index}` },
    }));
    findFollowsMock.mockResolvedValue(candidates);
    findMatchesMock.mockResolvedValue([]);

    const response = await GET();
    const payload = await response.json();
    const authorizationCall = findPublicTeamsMock.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(payload).toHaveLength(100);
    expect(authorizationCall.where.id.in).toHaveLength(100);
    expect(authorizationCall.take).toBe(100);
    expect(findFollowsMock).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it('fails closed when public-team authorization cannot reach the database', async () => {
    findPublicTeamsMock.mockRejectedValue(new Error('database unavailable'));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'MY_TEAMS_UNAVAILABLE', retryable: true },
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(findMatchesMock).not.toHaveBeenCalled();
  });
});
