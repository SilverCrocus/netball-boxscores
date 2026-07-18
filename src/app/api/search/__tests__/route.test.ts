import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMatchesMock, findPlayersMock, findTeamsMock, resolvePublicMatchBatchMock } = vi.hoisted(() => ({
  findMatchesMock: vi.fn(),
  findPlayersMock: vi.fn(),
  findTeamsMock: vi.fn(),
  resolvePublicMatchBatchMock: vi.fn(),
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
vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccessBatch: resolvePublicMatchBatchMock,
  canExposePublicMatchScore: (access: { scoreAvailable: boolean }) => access.scoreAvailable,
}));

import { GET } from '../route';

describe('GET /api/search', () => {
  beforeEach(() => {
    findPlayersMock.mockReset().mockResolvedValue([]);
    findTeamsMock.mockReset().mockResolvedValue([]);
    findMatchesMock.mockReset().mockResolvedValue([]);
    resolvePublicMatchBatchMock.mockReset().mockResolvedValue(new Map([['match-1', {
      id: 'match-1', status: 'COMPLETED', scoreAvailable: true,
    }]]));
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

  it('filters denied matches and does not expose a score that fails public score policy', async () => {
    findMatchesMock.mockResolvedValue([
      {
        id: 'unpublished-stage', competitionId: 'competition-2026', round: null,
        roundLabel: 'Pool A', finalCode: null, stage: { name: 'Pool Stage' }, status: 'COMPLETED',
        homeScore: 70, awayScore: 60,
        homeTeamId: 'a', awayTeamId: 'b',
        homeTeam: { name: 'Australia' }, awayTeam: { name: 'England' },
      },
      {
        id: 'unverified-score', competitionId: 'competition-2026', round: null,
        roundLabel: 'Pool A', finalCode: null, stage: { name: 'Pool Stage' }, status: 'COMPLETED',
        homeScore: 99, awayScore: 98,
        homeTeamId: 'c', awayTeamId: 'd',
        homeTeam: { name: 'Jamaica' }, awayTeam: { name: 'New Zealand' },
      },
    ]);
    resolvePublicMatchBatchMock.mockResolvedValue(new Map([['unverified-score', {
      id: 'unverified-score', status: 'COMPLETED', scoreAvailable: false,
    }]]));

    const response = await GET(new Request('https://centrepass.test/api/search?q=pool'));
    const payload = await response.json();

    expect(payload.matches).toEqual([
      expect.objectContaining({ id: 'unverified-score', meta: 'Pool A' }),
    ]);
    expect(JSON.stringify(payload.matches)).not.toContain('99-98');
  });
});
