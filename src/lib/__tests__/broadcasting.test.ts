import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolvePublicMatchMock } = vi.hoisted(() => ({
  resolvePublicMatchMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    player: { findMany: vi.fn() },
    scoreFlow: { findMany: vi.fn() },
    matchEvent: { createManyAndReturn: vi.fn() },
  },
  excludeSimData: {},
}));

vi.mock('@/lib/socket-server', () => ({
  broadcastScoreUpdate: vi.fn().mockResolvedValue(true),
  broadcastMatchStatus: vi.fn().mockResolvedValue(true),
  broadcastStatsUpdate: vi.fn().mockResolvedValue(true),
  broadcastScoreFlowAdd: vi.fn().mockResolvedValue(true),
  broadcastStatEvent: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/public-match', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/public-match')>();
  return { ...actual, resolvePublicMatchAccess: resolvePublicMatchMock };
});

import { prisma } from '@/lib/db';
import { resolveEditionFeatures } from '@/lib/edition-capabilities';
import {
  broadcastCompletion,
  broadcastMatchChanges,
  broadcastPlayerStats,
  broadcastPersistedStatEvents,
  broadcastScoreFlowDelta,
  persistStatEvents,
  resetScoreFlowTracking,
} from '@/lib/broadcasting';
import {
  broadcastMatchStatus,
  broadcastScoreFlowAdd,
  broadcastScoreUpdate,
  broadcastStatEvent,
  broadcastStatsUpdate,
} from '@/lib/socket-server';

const mockScoreFlowFindMany = vi.mocked(prisma.scoreFlow.findMany);
const mockPlayerFindMany = vi.mocked(prisma.player.findMany);
const mockEventCreateManyAndReturn = vi.mocked(prisma.matchEvent.createManyAndReturn);

function publicAccess(
  capabilities: Array<
    | 'FINAL_SCORE'
    | 'PLAYER_BOX_SCORE'
    | 'SCORE_FLOW'
    | 'MATCH_EVENTS'
    | 'LINEUPS'
  > = ['FINAL_SCORE', 'PLAYER_BOX_SCORE', 'SCORE_FLOW', 'MATCH_EVENTS', 'LINEUPS'],
  status: 'LIVE' | 'COMPLETED' = 'LIVE',
  resultQuality: 'UNKNOWN' | 'OFFICIAL_FINAL' = status === 'COMPLETED' ? 'OFFICIAL_FINAL' : 'UNKNOWN',
) {
  return {
    id: 'match-1',
    competitionId: 'edition-1',
    status,
    resultQuality,
    scheduledAt: new Date('2026-07-25T09:00:00Z'),
    homeTeamId: 'country-a',
    awayTeamId: 'country-b',
    features: resolveEditionFeatures(
      capabilities.map((capability) => ({ capability, state: 'AVAILABLE' as const })),
    ),
  };
}

function playerStat(overrides: Record<string, unknown> = {}) {
  return {
    playerId: 10,
    position: 'GS',
    goals: 5,
    attempts: 6,
    goalAssists: 1,
    intercepts: 0,
    deflections: 0,
    rebounds: 0,
    penalties: 1,
    feeds: 2,
    centrePassReceives: 0,
    turnovers: 0,
    minutesPlayed: 30,
    ...overrides,
  };
}

function matchDetail(home = [playerStat()], away: ReturnType<typeof playerStat>[] = []) {
  return { playerStats: { home, away } } as never;
}

function dbMatch() {
  return {
    id: 'match-1',
    homeTeamId: 'country-a',
    awayTeamId: 'country-b',
    homeTeam: {
      id: 'country-a', name: 'Country A', abbreviation: 'CTA', logoUrl: null,
      championDataTeamId: null,
    },
    awayTeam: {
      id: 'country-b', name: 'Country B', abbreviation: 'CTB', logoUrl: null,
      championDataTeamId: null,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetScoreFlowTracking();
  resolvePublicMatchMock.mockResolvedValue(publicAccess());
  mockScoreFlowFindMany.mockResolvedValue([]);
  mockPlayerFindMany.mockResolvedValue([]);
  mockEventCreateManyAndReturn.mockResolvedValue([]);
});

describe('broadcastScoreFlowDelta', () => {
  it('broadcasts all entries on first call and only changed identities later', async () => {
    mockScoreFlowFindMany.mockResolvedValue([
      { id: '1', period: 1, periodSeconds: 100, scoringTeamId: 't1', homeScore: 1, awayScore: 0, scorePoints: 1, scorerPlayer: null },
      { id: '2', period: 1, periodSeconds: 200, scoringTeamId: 't1', homeScore: 2, awayScore: 0, scorePoints: 1, scorerPlayer: null },
    ] as never);
    await broadcastScoreFlowDelta('match-1');
    expect(broadcastScoreFlowAdd).toHaveBeenCalledTimes(2);

    vi.mocked(broadcastScoreFlowAdd).mockClear();
    mockScoreFlowFindMany.mockResolvedValue([
      { id: '1', period: 1, periodSeconds: 100, scoringTeamId: 't1', homeScore: 1, awayScore: 0, scorePoints: 1, scorerPlayer: null },
      { id: '2', period: 1, periodSeconds: 200, scoringTeamId: 't1', homeScore: 2, awayScore: 0, scorePoints: 1, scorerPlayer: null },
      { id: '3', period: 1, periodSeconds: 300, scoringTeamId: 't2', homeScore: 2, awayScore: 1, scorePoints: 1, scorerPlayer: { id: 'p1', name: 'Smith' } },
    ] as never);
    await broadcastScoreFlowDelta('match-1');

    expect(broadcastScoreFlowAdd).toHaveBeenCalledOnce();
  });

  it('rebroadcasts a correction to an existing score-flow identity', async () => {
    mockScoreFlowFindMany.mockResolvedValue([
      { id: '1', period: 1, periodSeconds: 100, scoringTeamId: 't1', homeScore: 1, awayScore: 0, scorePoints: 1, scorerPlayer: null },
    ] as never);
    await broadcastScoreFlowDelta('match-1');
    vi.mocked(broadcastScoreFlowAdd).mockClear();

    mockScoreFlowFindMany.mockResolvedValue([
      { id: '1', period: 1, periodSeconds: 100, scoringTeamId: 't1', homeScore: 2, awayScore: 0, scorePoints: 2, scorerPlayer: null },
    ] as never);
    await broadcastScoreFlowDelta('match-1');

    expect(broadcastScoreFlowAdd).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({ scorePoints: 2, homeScore: 2 }),
      expect.objectContaining({ id: 'match-1' }),
    );
  });

  it('does not even query private score flow when public access is denied', async () => {
    resolvePublicMatchMock.mockResolvedValue(null);

    await broadcastScoreFlowDelta('match-1');

    expect(mockScoreFlowFindMany).not.toHaveBeenCalled();
    expect(broadcastScoreFlowAdd).not.toHaveBeenCalled();
  });

  it('fails closed without breaking the worker when access resolution errors', async () => {
    resolvePublicMatchMock.mockRejectedValue(new Error('publication lookup failed'));

    await expect(broadcastScoreFlowDelta('match-1')).resolves.toBeUndefined();

    expect(mockScoreFlowFindMany).not.toHaveBeenCalled();
  });
});

describe('player and match broadcasts', () => {
  it('omits current position unless lineup coverage is public', async () => {
    mockPlayerFindMany.mockResolvedValue([
      { id: 'player-1', championDataPlayerId: 10 },
    ] as never);

    resolvePublicMatchMock.mockResolvedValue(publicAccess(['PLAYER_BOX_SCORE']));
    await broadcastPlayerStats(
      'match-1',
      matchDetail(),
      publicAccess(['PLAYER_BOX_SCORE']),
    );
    expect(broadcastStatsUpdate).toHaveBeenLastCalledWith(
      'match-1',
      expect.objectContaining({
        playerStats: [expect.not.objectContaining({ currentPosition: expect.anything() })],
      }),
      expect.anything(),
    );

    vi.mocked(broadcastStatsUpdate).mockClear();
    resolvePublicMatchMock.mockResolvedValue(publicAccess(['PLAYER_BOX_SCORE', 'LINEUPS']));
    await broadcastPlayerStats(
      'match-1',
      matchDetail(),
      publicAccess(['PLAYER_BOX_SCORE', 'LINEUPS']),
    );
    expect(broadcastStatsUpdate).toHaveBeenLastCalledWith(
      'match-1',
      expect.objectContaining({
        playerStats: [expect.objectContaining({ currentPosition: 'GS' })],
      }),
      expect.anything(),
    );
  });

  it('does not query player rows without player box-score coverage', async () => {
    resolvePublicMatchMock.mockResolvedValue(publicAccess([]));
    await broadcastPlayerStats('match-1', matchDetail(), publicAccess([]));

    expect(mockPlayerFindMany).not.toHaveBeenCalled();
    expect(broadcastStatsUpdate).not.toHaveBeenCalled();
  });

  it('emits only supported lifecycle status values', async () => {
    await broadcastMatchChanges({
      matchId: 'match-1',
      scoreChanged: false,
      statusChanged: true,
      timeChanged: false,
      newHomeScore: 0,
      newAwayScore: 0,
      newStatus: 'SCHEDULED',
      currentQuarter: 0,
      currentTime: '0',
    }, {} as never, null, publicAccess());

    expect(broadcastMatchStatus).not.toHaveBeenCalled();
  });

  it('does not broadcast an unverified completed result', async () => {
    resolvePublicMatchMock.mockResolvedValue(publicAccess(
      ['FINAL_SCORE'],
      'COMPLETED',
      'UNKNOWN',
    ));

    await broadcastCompletion('match-1', 60, 59, 4);

    expect(broadcastMatchStatus).not.toHaveBeenCalled();
    expect(broadcastScoreUpdate).not.toHaveBeenCalled();
  });
});

describe('stat event persistence', () => {
  it('persists before emit and uses the source side rather than a permanent player team', async () => {
    mockPlayerFindMany.mockResolvedValue([
      { id: 'player-home', name: 'Home International', championDataPlayerId: 10 },
      { id: 'player-away', name: 'Away International', championDataPlayerId: 20 },
    ] as never);
    const detail = matchDetail(
      [playerStat({ playerId: 10, intercepts: 1 })],
      [playerStat({ playerId: 20, turnovers: 1 })],
    );
    mockEventCreateManyAndReturn.mockResolvedValue([
      { id: 'event-home', playerId: 'player-home', type: 'intercept', period: 2, periodSeconds: 300 },
      { id: 'event-away', playerId: 'player-away', type: 'turnover', period: 2, periodSeconds: 300 },
    ] as never);

    const events = await persistStatEvents('match-1', detail, dbMatch(), new Map(), 2, 300);
    await broadcastPersistedStatEvents('match-1', events);

    expect(mockEventCreateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ playerId: 'player-home', teamId: 'country-a', type: 'intercept' }),
        expect.objectContaining({ playerId: 'player-away', teamId: 'country-b', type: 'turnover' }),
      ]),
    }));
    expect(broadcastStatEvent).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        eventId: 'event-home', playerId: 'player-home', teamId: 'country-a', isHomeTeam: true,
      }),
      expect.anything(),
    );
    expect(mockEventCreateManyAndReturn.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(broadcastStatEvent).mock.invocationCallOrder[0],
    );
  });

  it('still persists canonical events when public MATCH_EVENTS coverage is unavailable', async () => {
    mockPlayerFindMany.mockResolvedValue([
      { id: 'player-home', name: 'Home International', championDataPlayerId: 10 },
    ] as never);

    mockEventCreateManyAndReturn.mockResolvedValue([
      { id: 'event-home', playerId: 'player-home', type: 'intercept', period: 1, periodSeconds: 100 },
    ] as never);
    const events = await persistStatEvents(
      'match-1',
      matchDetail([playerStat({ intercepts: 1 })]),
      dbMatch(),
      new Map(),
      1,
      100,
    );
    resolvePublicMatchMock.mockResolvedValue(publicAccess([]));
    await broadcastPersistedStatEvents('match-1', events);

    expect(mockEventCreateManyAndReturn).toHaveBeenCalledOnce();
    expect(broadcastStatEvent).not.toHaveBeenCalled();
  });

  it('still persists canonical events when the public-access lookup fails', async () => {
    mockPlayerFindMany.mockResolvedValue([
      { id: 'player-home', name: 'Home International', championDataPlayerId: 10 },
    ] as never);
    mockEventCreateManyAndReturn.mockResolvedValue([
      { id: 'event-home', playerId: 'player-home', type: 'intercept', period: 1, periodSeconds: 100 },
    ] as never);

    const events = await persistStatEvents(
      'match-1',
      matchDetail([playerStat({ intercepts: 1 })]),
      dbMatch(),
      new Map(),
      1,
      100,
    );
    resolvePublicMatchMock.mockRejectedValue(new Error('publication lookup failed'));
    await expect(broadcastPersistedStatEvents('match-1', events)).resolves.toBeUndefined();

    expect(mockEventCreateManyAndReturn).toHaveBeenCalledOnce();
    expect(broadcastStatEvent).not.toHaveBeenCalled();
  });

  it('does not emit a candidate when another worker won the insert race', async () => {
    mockPlayerFindMany.mockResolvedValue([
      { id: 'player-home', name: 'Home International', championDataPlayerId: 10 },
    ] as never);
    mockEventCreateManyAndReturn.mockResolvedValue([]);

    const events = await persistStatEvents(
      'match-1',
      matchDetail([playerStat({ intercepts: 1 })]),
      dbMatch(),
      new Map(),
      1,
      100,
    );
    await broadcastPersistedStatEvents('match-1', events);

    expect(events).toEqual([]);
    expect(broadcastStatEvent).not.toHaveBeenCalled();
  });

  it('emits only the rows this worker inserted when a concurrent insert wins part of the batch', async () => {
    mockPlayerFindMany.mockResolvedValue([
      { id: 'player-home', name: 'Home International', championDataPlayerId: 10 },
      { id: 'player-away', name: 'Away International', championDataPlayerId: 20 },
    ] as never);
    mockEventCreateManyAndReturn.mockResolvedValue([
      { id: 'event-away', playerId: 'player-away', type: 'turnover', period: 2, periodSeconds: 300 },
    ] as never);

    const events = await persistStatEvents(
      'match-1',
      matchDetail(
        [playerStat({ playerId: 10, intercepts: 1 })],
        [playerStat({ playerId: 20, turnovers: 1 })],
      ),
      dbMatch(),
      new Map(),
      2,
      300,
    );
    await broadcastPersistedStatEvents('match-1', events);

    expect(broadcastStatEvent).toHaveBeenCalledOnce();
    expect(broadcastStatEvent).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({ eventId: 'event-away', playerId: 'player-away' }),
      expect.anything(),
    );
  });
});
