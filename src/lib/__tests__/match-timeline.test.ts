import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findEventsMock, findScoresMock, resolvePublicMatchMock } = vi.hoisted(() => ({
  findEventsMock: vi.fn(),
  findScoresMock: vi.fn(),
  resolvePublicMatchMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    matchEvent: { findMany: findEventsMock },
    scoreFlow: { findMany: findScoresMock },
  },
}));

vi.mock('@/lib/public-match', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/public-match')>();
  return { ...actual, resolvePublicMatchAccess: resolvePublicMatchMock };
});

import { resolveEditionFeatures } from '@/lib/edition-capabilities';

import {
  decodeTimelineCursor,
  encodeTimelineCursor,
  loadMatchTimeline,
} from '@/lib/match-timeline';

describe('match timeline loader', () => {
  beforeEach(() => {
    resolvePublicMatchMock.mockReset().mockResolvedValue({
      id: 'match-1',
      competitionId: 'edition-1',
      status: 'COMPLETED',
      resultQuality: 'OFFICIAL_FINAL',
      scheduledAt: new Date('2026-07-04T09:30:00Z'),
      homeTeamId: 'home',
      awayTeamId: 'away',
      features: resolveEditionFeatures([
        { capability: 'SCORE_FLOW', state: 'AVAILABLE' },
        { capability: 'MATCH_EVENTS', state: 'AVAILABLE' },
      ]),
    });
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

    resolvePublicMatchMock.mockResolvedValue(null);
    await expect(loadMatchTimeline('missing')).rejects.toThrow('MATCH_NOT_FOUND');
  });

  it('does not query timeline rows when public capabilities are unavailable', async () => {
    resolvePublicMatchMock.mockResolvedValue({
      id: 'match-1',
      competitionId: 'edition-1',
      status: 'COMPLETED',
      resultQuality: 'OFFICIAL_FINAL',
      scheduledAt: new Date('2026-07-04T09:30:00Z'),
      homeTeamId: 'home',
      awayTeamId: 'away',
      features: resolveEditionFeatures([]),
    });

    await expect(loadMatchTimeline('match-1')).resolves.toEqual({
      entries: [],
      nextCursor: null,
    });
    expect(findScoresMock).not.toHaveBeenCalled();
    expect(findEventsMock).not.toHaveBeenCalled();
  });

  it('does not query rows for a scheduled match even if coverage is configured', async () => {
    const access = await resolvePublicMatchMock();
    resolvePublicMatchMock.mockResolvedValue({ ...access, status: 'SCHEDULED' });

    await expect(loadMatchTimeline('match-1')).resolves.toEqual({
      entries: [],
      nextCursor: null,
    });
    expect(findScoresMock).not.toHaveBeenCalled();
    expect(findEventsMock).not.toHaveBeenCalled();
  });

  it('round-trips timeline cursors', () => {
    const cursor = { period: 4, periodSeconds: 200, source: 'score' as const, id: 'score-1' };
    expect(decodeTimelineCursor(encodeTimelineCursor(cursor))).toEqual(cursor);
  });
});
