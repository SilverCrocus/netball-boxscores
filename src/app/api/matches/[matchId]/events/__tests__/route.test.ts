import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadTimelineMock } = vi.hoisted(() => ({ loadTimelineMock: vi.fn() }));

vi.mock('@/lib/match-timeline', () => ({
  MATCH_TIMELINE_PAGE_SIZE: 75,
  loadMatchTimeline: loadTimelineMock,
}));

import { GET } from '../route';

const context = { params: Promise.resolve({ matchId: 'match-1' }) };

describe('GET /api/matches/[matchId]/events', () => {
  beforeEach(() => loadTimelineMock.mockReset().mockResolvedValue({ entries: [], nextCursor: null }));

  it('passes validated filters to the timeline loader', async () => {
    const response = await GET(
      new Request('https://centrepass.test/api/matches/match-1/events?limit=25&quarter=4&type=goal&team=home'),
      context,
    );

    expect(response.status).toBe(200);
    expect(loadTimelineMock).toHaveBeenCalledWith('match-1', {
      cursor: undefined,
      eventType: 'goal',
      limit: 25,
      quarter: 4,
      teamId: 'home',
    });
  });

  it('returns typed 400 responses for invalid filters', async () => {
    const response = await GET(
      new Request('https://centrepass.test/api/matches/match-1/events?quarter=9&type=unknown'),
      context,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_QUARTER', retryable: false },
    });
    expect(loadTimelineMock).not.toHaveBeenCalled();
  });

  it('distinguishes missing matches, bad cursors, and retryable failures', async () => {
    loadTimelineMock.mockRejectedValueOnce(new Error('MATCH_NOT_FOUND'));
    const missing = await GET(new Request('https://centrepass.test/api/matches/match-1/events'), context);
    expect(missing.status).toBe(404);

    loadTimelineMock.mockRejectedValueOnce(new Error('INVALID_CURSOR'));
    const badCursor = await GET(new Request('https://centrepass.test/api/matches/match-1/events?cursor=bad'), context);
    expect(badCursor.status).toBe(400);

    loadTimelineMock.mockRejectedValueOnce(new Error('database unavailable'));
    const unavailable = await GET(new Request('https://centrepass.test/api/matches/match-1/events'), context);
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      error: { code: 'TIMELINE_UNAVAILABLE', retryable: true },
    });
  });
});
