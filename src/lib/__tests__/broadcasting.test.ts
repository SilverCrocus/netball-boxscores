import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolvePublicMatchMock } = vi.hoisted(() => ({
  resolvePublicMatchMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    match: { findUnique: vi.fn() },
    player: { findMany: vi.fn() },
    playerMatchStats: { findMany: vi.fn() },
    scoreFlow: { findMany: vi.fn() },
    matchEvent: {
      createManyAndReturn: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  excludeSimData: {},
}));

vi.mock('@/lib/socket-server', () => ({
  broadcastScoreUpdate: vi.fn().mockResolvedValue(true),
  broadcastMatchStatus: vi.fn().mockResolvedValue(true),
  broadcastStatsUpdate: vi.fn().mockResolvedValue(true),
  broadcastScoreFlowAdd: vi.fn().mockResolvedValue(true),
  broadcastScoreFlowSnapshot: vi.fn().mockResolvedValue(true),
  broadcastStatEvent: vi.fn().mockResolvedValue(true),
  broadcastStatEventsSnapshot: vi.fn().mockResolvedValue(true),
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
  broadcastScoreFlowSnapshot,
  broadcastScoreUpdate,
  broadcastStatEventsSnapshot,
  broadcastStatsUpdate,
} from '@/lib/socket-server';

const mockScoreFlowFindMany = vi.mocked(prisma.scoreFlow.findMany);
const mockMatchFindUnique = vi.mocked(prisma.match.findUnique);
const mockPlayerFindMany = vi.mocked(prisma.player.findMany);
const mockPlayerStatsFindMany = vi.mocked(prisma.playerMatchStats.findMany);
const mockEventCreateManyAndReturn = vi.mocked(prisma.matchEvent.createManyAndReturn);
const mockEventFindMany = vi.mocked(prisma.matchEvent.findMany);
const mockEventDeleteMany = vi.mocked(prisma.matchEvent.deleteMany);

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
    sourceUpdatedAt: new Date('2026-07-25T09:00:01Z'),
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
  mockMatchFindUnique.mockResolvedValue({
    status: 'LIVE',
    homeScore: 10,
    awayScore: 9,
    currentQuarter: 2,
    currentTime: '300',
    sourceUpdatedAt: new Date('2026-07-25T09:00:01Z'),
  } as never);
  mockPlayerFindMany.mockResolvedValue([]);
  mockPlayerStatsFindMany.mockResolvedValue([]);
  mockEventCreateManyAndReturn.mockResolvedValue([]);
  mockEventFindMany.mockResolvedValue([]);
  mockEventDeleteMany.mockResolvedValue({ count: 0 });
});

describe('broadcastScoreFlowDelta', () => {
  it('broadcasts a complete canonical snapshot on every accepted revision', async () => {
    mockScoreFlowFindMany.mockResolvedValue([
      { id: '1', period: 1, periodSeconds: 100, scoringTeamId: 't1', homeScore: 1, awayScore: 0, scorePoints: 1, scorerPlayer: null },
      { id: '2', period: 1, periodSeconds: 200, scoringTeamId: 't1', homeScore: 2, awayScore: 0, scorePoints: 1, scorerPlayer: null },
    ] as never);
    await broadcastScoreFlowDelta('match-1');
    expect(broadcastScoreFlowSnapshot).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({ entries: expect.arrayContaining([
        expect.objectContaining({ homeScore: 1, awayScore: 0 }),
        expect.objectContaining({ homeScore: 2, awayScore: 0 }),
      ]) }),
      expect.anything(),
      undefined,
    );

    vi.mocked(broadcastScoreFlowSnapshot).mockClear();
    mockScoreFlowFindMany.mockResolvedValue([
      { id: '1', period: 1, periodSeconds: 100, scoringTeamId: 't1', homeScore: 1, awayScore: 0, scorePoints: 1, scorerPlayer: null },
      { id: '2', period: 1, periodSeconds: 200, scoringTeamId: 't1', homeScore: 2, awayScore: 0, scorePoints: 1, scorerPlayer: null },
      { id: '3', period: 1, periodSeconds: 300, scoringTeamId: 't2', homeScore: 2, awayScore: 1, scorePoints: 1, scorerPlayer: { id: 'p1', name: 'Smith' } },
    ] as never);
    await broadcastScoreFlowDelta('match-1');

    expect(broadcastScoreFlowSnapshot).toHaveBeenCalledOnce();
    expect(vi.mocked(broadcastScoreFlowSnapshot).mock.calls[0][1].entries).toHaveLength(3);
  });

  it('replaces the snapshot when an existing score-flow identity is corrected', async () => {
    mockScoreFlowFindMany.mockResolvedValue([
      { id: '1', period: 1, periodSeconds: 100, scoringTeamId: 't1', homeScore: 1, awayScore: 0, scorePoints: 1, scorerPlayer: null },
    ] as never);
    await broadcastScoreFlowDelta('match-1');
    vi.mocked(broadcastScoreFlowSnapshot).mockClear();

    mockScoreFlowFindMany.mockResolvedValue([
      { id: '1', period: 1, periodSeconds: 100, scoringTeamId: 't1', homeScore: 2, awayScore: 0, scorePoints: 2, scorerPlayer: null },
    ] as never);
    await broadcastScoreFlowDelta('match-1');

    expect(broadcastScoreFlowSnapshot).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        entries: [expect.objectContaining({ scorePoints: 2, homeScore: 2 })],
      }),
      expect.objectContaining({ id: 'match-1' }),
      undefined,
    );
  });

  it('emits an empty replacement snapshot when a correction removes score flow', async () => {
    mockScoreFlowFindMany.mockResolvedValueOnce([
      { id: '1', period: 1, periodSeconds: 100, scoringTeamId: 't1', homeScore: 1, awayScore: 0, scorePoints: 1, scorerPlayer: null },
    ] as never).mockResolvedValueOnce([]);

    await broadcastScoreFlowDelta('match-1');
    await broadcastScoreFlowDelta('match-1');

    expect(broadcastScoreFlowSnapshot).toHaveBeenLastCalledWith(
      'match-1',
      { matchId: 'match-1', entries: [] },
      expect.anything(),
      undefined,
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
      undefined,
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
      undefined,
    );
  });

  it('does not query player rows without player box-score coverage', async () => {
    resolvePublicMatchMock.mockResolvedValue(publicAccess([]));
    await broadcastPlayerStats('match-1', matchDetail(), publicAccess([]));

    expect(mockPlayerFindMany).not.toHaveBeenCalled();
    expect(broadcastStatsUpdate).not.toHaveBeenCalled();
  });

  it('emits the canonical lifecycle instead of a stale raw status delta', async () => {
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

    expect(broadcastMatchStatus).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({ status: 'LIVE' }),
      expect.anything(),
      undefined,
    );
    expect(broadcastMatchStatus).not.toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({ status: 'SCHEDULED' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('uses the canonical score and suppresses a superseded expected revision', async () => {
    await broadcastMatchChanges({
      matchId: 'match-1',
      scoreChanged: true,
      statusChanged: false,
      timeChanged: false,
      newHomeScore: 99,
      newAwayScore: 0,
      newStatus: 'LIVE',
      currentQuarter: 2,
      currentTime: '300',
    }, {} as never, null, publicAccess(), '2026-07-25T09:00:01.000Z');

    expect(broadcastScoreUpdate).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({ homeScore: 10, awayScore: 9 }),
      expect.anything(),
      '2026-07-25T09:00:01.000Z',
    );

    vi.mocked(broadcastScoreUpdate).mockClear();
    await broadcastMatchChanges({
      matchId: 'match-1',
      scoreChanged: true,
      statusChanged: false,
      timeChanged: false,
      newHomeScore: 8,
      newAwayScore: 7,
      newStatus: 'LIVE',
      currentQuarter: 2,
      currentTime: '250',
    }, {} as never, null, publicAccess(), '2026-07-25T09:00:00.000Z');

    expect(broadcastScoreUpdate).not.toHaveBeenCalled();
  });

  it('broadcasts completion only from the canonical committed final revision', async () => {
    resolvePublicMatchMock.mockResolvedValue(publicAccess(
      ['FINAL_SCORE', 'PLAYER_BOX_SCORE', 'SCORE_FLOW', 'MATCH_EVENTS'],
      'COMPLETED',
    ));
    mockMatchFindUnique.mockResolvedValue({
      status: 'COMPLETED',
      homeScore: 60,
      awayScore: 39,
      currentQuarter: 4,
      sourceUpdatedAt: new Date('2026-07-25T09:00:01Z'),
    } as never);

    await broadcastCompletion('match-1', 61, 40, 3, '2026-07-25T09:00:01.000Z');

    expect(broadcastScoreUpdate).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({ homeScore: 60, awayScore: 39, currentQuarter: 4 }),
      expect.anything(),
      '2026-07-25T09:00:01.000Z',
    );
    expect(broadcastStatsUpdate).toHaveBeenCalledWith(
      'match-1',
      { matchId: 'match-1', playerStats: [] },
      expect.anything(),
      '2026-07-25T09:00:01.000Z',
    );
    expect(broadcastStatEventsSnapshot).toHaveBeenCalledWith(
      'match-1',
      { matchId: 'match-1', events: [] },
      expect.anything(),
      '2026-07-25T09:00:01.000Z',
    );
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
  it('deletes excess inferred events when a player aggregate is corrected downward', async () => {
    mockPlayerFindMany.mockResolvedValue([
      { id: 'player-home', name: 'Home International', championDataPlayerId: 10 },
    ] as never);
    mockEventFindMany.mockResolvedValue([{ id: 'excess-event' }] as never);

    const events = await persistStatEvents(
      'match-1',
      matchDetail([playerStat({ intercepts: 1 })]),
      dbMatch(),
      new Map([['player-home', {
        intercept: 2,
        deflection: 0,
        rebound: 0,
        turnover: 0,
      }]]),
      2,
      300,
    );

    expect(events).toEqual([]);
    expect(mockEventDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['excess-event'] } },
    });
    expect(mockEventCreateManyAndReturn).not.toHaveBeenCalled();
  });

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
    mockEventFindMany.mockResolvedValue([
      {
        id: 'event-home', type: 'intercept', period: 2, periodSeconds: 300,
        player: { id: 'player-home', name: 'Home International' },
        team: { id: 'country-a', name: 'Country A', abbreviation: 'CTA', logoUrl: null },
        match: { homeTeamId: 'country-a' },
      },
      {
        id: 'event-away', type: 'turnover', period: 2, periodSeconds: 300,
        player: { id: 'player-away', name: 'Away International' },
        team: { id: 'country-b', name: 'Country B', abbreviation: 'CTB', logoUrl: null },
        match: { homeTeamId: 'country-a' },
      },
    ] as never);

    const events = await persistStatEvents('match-1', detail, dbMatch(), new Map(), 2, 300);
    await broadcastPersistedStatEvents('match-1', events);

    expect(mockEventCreateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ playerId: 'player-home', teamId: 'country-a', type: 'intercept' }),
        expect.objectContaining({ playerId: 'player-away', teamId: 'country-b', type: 'turnover' }),
      ]),
    }));
    expect(broadcastStatEventsSnapshot).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        events: expect.arrayContaining([
          expect.objectContaining({
            eventId: 'event-home', playerId: 'player-home', teamId: 'country-a', isHomeTeam: true,
          }),
        ]),
      }),
      expect.anything(),
      undefined,
    );
    expect(mockEventCreateManyAndReturn.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(broadcastStatEventsSnapshot).mock.invocationCallOrder[0],
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
    expect(broadcastStatEventsSnapshot).not.toHaveBeenCalled();
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
    expect(broadcastStatEventsSnapshot).not.toHaveBeenCalled();
  });

  it('replays the canonical snapshot when another worker won the insert race', async () => {
    mockPlayerFindMany.mockResolvedValue([
      { id: 'player-home', name: 'Home International', championDataPlayerId: 10 },
    ] as never);
    mockEventCreateManyAndReturn.mockResolvedValue([]);
    mockEventFindMany.mockResolvedValue([{
      id: 'existing-event', type: 'intercept', period: 1, periodSeconds: 100,
      player: { id: 'player-home', name: 'Home International' },
      team: { id: 'country-a', name: 'Country A', abbreviation: 'CTA', logoUrl: null },
      match: { homeTeamId: 'country-a' },
    }] as never);

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
    expect(broadcastStatEventsSnapshot).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        events: [expect.objectContaining({ eventId: 'existing-event' })],
      }),
      expect.anything(),
      undefined,
    );
  });

  it('emits one canonical batch when a concurrent insert wins part of the batch', async () => {
    mockPlayerFindMany.mockResolvedValue([
      { id: 'player-home', name: 'Home International', championDataPlayerId: 10 },
      { id: 'player-away', name: 'Away International', championDataPlayerId: 20 },
    ] as never);
    mockEventCreateManyAndReturn.mockResolvedValue([
      { id: 'event-away', playerId: 'player-away', type: 'turnover', period: 2, periodSeconds: 300 },
    ] as never);
    mockEventFindMany.mockResolvedValue([{
      id: 'event-away', type: 'turnover', period: 2, periodSeconds: 300,
      player: { id: 'player-away', name: 'Away International' },
      team: { id: 'country-b', name: 'Country B', abbreviation: 'CTB', logoUrl: null },
      match: { homeTeamId: 'country-a' },
    }] as never);

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

    expect(broadcastStatEventsSnapshot).toHaveBeenCalledOnce();
    expect(broadcastStatEventsSnapshot).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        events: [expect.objectContaining({ eventId: 'event-away', playerId: 'player-away' })],
      }),
      expect.anything(),
      undefined,
    );
  });
});
