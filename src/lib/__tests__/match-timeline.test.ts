import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findEventsMock, findMatchMock, findScoresMock } = vi.hoisted(() => ({
  findEventsMock: vi.fn(),
  findMatchMock: vi.fn(),
  findScoresMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    match: { findUnique: findMatchMock },
    matchEvent: { findMany: findEventsMock },
    scoreFlow: { findMany: findScoresMock },
  },
}));

import {
  decodeTimelineCursor,
  encodeTimelineCursor,
  loadMatchTimeline,
} from '@/lib/match-timeline';

describe('match timeline loader', () => {
  beforeEach(() => {
    findMatchMock.mockReset().mockResolvedValue({ id: 'match-1' });
    findScoresMock.mockReset().mockResolvedValue([]);
    findEventsMock.mockReset().mockResolvedValue([]);
  });

  it('merges goals and stat events newest first with a bounded cursor', async () => {
    findScoresMock.mockResolvedValue([
      {
        id: 'score-2', period: 4, periodSeconds: 300, scoringTeamId: 'home',
        homeScore: 60, awayScore: 55, scorePoints: 1,
        scorerPlayer: { id: 'player-1', name: 'Shooter', photoUrl: null },
      },
      {
        id: 'score-1', period: 4, periodSeconds: 200, scoringTeamId: 'away',
        homeScore: 59, awayScore: 55, scorePoints: 2, scorerPlayer: null,
      },
    ]);
    findEventsMock.mockResolvedValue([
      {
        id: 'event-1', period: 4, periodSeconds: 250, type: 'intercept', teamId: 'home',
        player: { id: 'player-2', name: 'Defender', photoUrl: null },
      },
    ]);

    const page = await loadMatchTimeline('match-1', { limit: 2 });

    expect(page.entries.map((entry) => entry.id)).toEqual(['score-2', 'event-1']);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeTimelineCursor(page.nextCursor!)).toMatchObject({
      period: 4,
      periodSeconds: 250,
      source: 'event',
      id: 'event-1',
    });
  });

  it('pushes quarter, team, and event filters into the database query', async () => {
    await loadMatchTimeline('match-1', {
      quarter: 3,
      teamId: 'home',
      eventType: 'turnover',
    });

    expect(findScoresMock).not.toHaveBeenCalled();
    expect(findEventsMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        matchId: 'match-1',
        period: 3,
        teamId: 'home',
        type: 'turnover',
      }),
      take: 76,
    }));
  });

  it('rejects invalid cursors and unknown matches', async () => {
    await expect(loadMatchTimeline('match-1', { cursor: 'invalid' })).rejects.toThrow('INVALID_CURSOR');

    findMatchMock.mockResolvedValue(null);
    await expect(loadMatchTimeline('missing')).rejects.toThrow('MATCH_NOT_FOUND');
  });

  it('round-trips timeline cursors', () => {
    const cursor = { period: 4, periodSeconds: 200, source: 'score' as const, id: 'score-1' };
    expect(decodeTimelineCursor(encodeTimelineCursor(cursor))).toEqual(cursor);
  });
});
