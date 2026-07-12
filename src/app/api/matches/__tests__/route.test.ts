import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadPageMock, resolveCompetitionMock } = vi.hoisted(() => ({
  loadPageMock: vi.fn(),
  resolveCompetitionMock: vi.fn(),
}));

vi.mock('@/lib/competitions', () => ({ resolveCompetition: resolveCompetitionMock }));
vi.mock('@/lib/home-feed', () => ({ getCompletedMatchesPage: loadPageMock }));

import { GET } from '../route';

describe('GET /api/matches', () => {
  beforeEach(() => {
    resolveCompetitionMock.mockReset().mockResolvedValue({
      competition: { id: 'competition-2026', season: 2026 },
    });
    loadPageMock.mockReset().mockResolvedValue({ groups: [], nextCursor: null });
  });

  it('resolves the requested season and forwards the cursor', async () => {
    const response = await GET(new Request('https://centrepass.test/api/matches?season=2026&cursor=next-page'));

    expect(response.status).toBe(200);
    expect(resolveCompetitionMock).toHaveBeenCalledWith('2026');
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
