import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  loadPageMock,
  resolveCompetitionMock,
  resolveCompetitionByIdMock,
  resolveLegacyLeagueCompetitionMock,
} = vi.hoisted(() => ({
  loadPageMock: vi.fn(),
  resolveCompetitionMock: vi.fn(),
  resolveCompetitionByIdMock: vi.fn(),
  resolveLegacyLeagueCompetitionMock: vi.fn(),
}));

vi.mock('@/lib/competitions', () => ({
  resolveCompetition: resolveCompetitionMock,
  resolveCompetitionById: resolveCompetitionByIdMock,
  resolveLegacyLeagueCompetition: resolveLegacyLeagueCompetitionMock,
}));
vi.mock('@/lib/home-feed', () => ({ getCompletedMatchesPage: loadPageMock }));

import { GET } from '../route';

describe('GET /api/matches', () => {
  beforeEach(() => {
    resolveCompetitionMock.mockReset().mockResolvedValue({
      competition: { id: 'competition-2026', season: 2026 },
    });
    resolveCompetitionByIdMock.mockReset().mockResolvedValue({
      competition: { id: 'glasgow-2026', season: 2026 },
    });
    resolveLegacyLeagueCompetitionMock.mockReset().mockResolvedValue({
      competition: { id: 'competition-2026', season: 2026 },
    });
    loadPageMock.mockReset().mockResolvedValue({ groups: [], nextCursor: null });
  });

  it('prefers a canonical edition id when competitions share a year', async () => {
    const response = await GET(new Request('https://centrepass.test/api/matches?edition=glasgow-2026&season=2026'));

    expect(response.status).toBe(200);
    expect(resolveCompetitionByIdMock).toHaveBeenCalledWith('glasgow-2026');
    expect(resolveCompetitionMock).not.toHaveBeenCalled();
    expect(loadPageMock).toHaveBeenCalledWith('glasgow-2026', undefined);
  });

  it('resolves the requested season and forwards the cursor', async () => {
    const response = await GET(new Request('https://centrepass.test/api/matches?season=2026&cursor=next-page'));

    expect(response.status).toBe(200);
    expect(resolveLegacyLeagueCompetitionMock).toHaveBeenCalledWith('2026');
    expect(loadPageMock).toHaveBeenCalledWith('competition-2026', 'next-page');
  });

  it('returns a typed client error for an invalid cursor', async () => {
    loadPageMock.mockRejectedValue(new Error('INVALID_CURSOR'));

    const response = await GET(new Request('https://centrepass.test/api/matches?cursor=bad'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_CURSOR', retryable: false },
    });
  });

  it('returns a retryable typed error when data is unavailable', async () => {
    resolveCompetitionMock.mockRejectedValue(new Error('database unavailable'));

    const response = await GET(new Request('https://centrepass.test/api/matches'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RESULTS_UNAVAILABLE', retryable: true },
    });
  });
});
