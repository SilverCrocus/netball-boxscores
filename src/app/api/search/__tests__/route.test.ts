import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMatchesMock, findPlayersMock, findTeamsMock } = vi.hoisted(() => ({
  findMatchesMock: vi.fn(),
  findPlayersMock: vi.fn(),
  findTeamsMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  excludeSimData: {},
  prisma: {
    player: { findMany: findPlayersMock },
    team: { findMany: findTeamsMock },
    match: { findMany: findMatchesMock },
  },
}));

vi.mock('@/lib/competitions', () => ({
  getPublicCompetitions: vi.fn().mockResolvedValue([{ id: 'competition-2026' }]),
}));

import { GET } from '../route';

describe('GET /api/search', () => {
  beforeEach(() => {
    findPlayersMock.mockReset().mockResolvedValue([]);
    findTeamsMock.mockReset().mockResolvedValue([]);
    findMatchesMock.mockReset().mockResolvedValue([]);
  });

  it('does not query the database below two characters', async () => {
    const response = await GET(new Request('https://centrepass.test/api/search?q=v'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ players: [], teams: [], matches: [] });
    expect(findPlayersMock).not.toHaveBeenCalled();
  });

  it('returns at most five grouped results', async () => {
    findPlayersMock.mockResolvedValue([
      { id: 'player-1', name: 'Vix Player', position: 'C', team: { name: 'Melbourne Vixens' } },
    ]);
    findTeamsMock.mockResolvedValue([
      { id: 'team-1', name: 'Melbourne Vixens', slug: 'melbourne-vixens', abbreviation: 'VIX' },
    ]);
    findMatchesMock.mockResolvedValue([
      {
        id: 'match-1', competitionId: 'competition-2026', round: 14, finalCode: null, status: 'COMPLETED',
        homeScore: 60, awayScore: 55,
        homeTeam: { name: 'Melbourne Vixens' }, awayTeam: { name: 'West Coast Fever' },
      },
    ]);

    const response = await GET(new Request('https://centrepass.test/api/search?q=vix'));
    const payload = await response.json();

    expect(payload).toMatchObject({
      players: [{ href: '/player/player-1', kind: 'player' }],
      teams: [{ href: '/team/melbourne-vixens', kind: 'team' }],
      matches: [{ href: '/match/match-1?edition=competition-2026', kind: 'match' }],
    });
    expect(findPlayersMock).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
    expect(findTeamsMock).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
    expect(findMatchesMock).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
  });

  it('returns a retryable typed error for database failures', async () => {
    findPlayersMock.mockRejectedValue(new Error('database unavailable'));

    const response = await GET(new Request('https://centrepass.test/api/search?q=vix'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SEARCH_UNAVAILABLE', retryable: true },
    });
  });
});
