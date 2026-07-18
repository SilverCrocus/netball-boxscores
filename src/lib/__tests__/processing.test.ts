import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyChanges,
  finalizeCompletedMatches,
  validateMatchData,
  reconcileCompletedMatches,
  reconcileStaleCompletedScores,
  syncFixtureMatches,
} from '@/lib/processing';
import { fetchMatchStats } from '@/lib/champion-data';
import { prisma } from '@/lib/db';
import type { CDFixtureMatch, CDMatchStatsResponse } from '@/types/champion-data';

const standingsMocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  rebuild: vi.fn(),
}));

vi.mock('@/lib/champion-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/champion-data')>();
  return { ...actual, fetchMatchStats: vi.fn() };
});

vi.mock('@/lib/db', () => {
  const transactionClient = {
    competition: { findUnique: vi.fn() },
    team: { findMany: vi.fn() },
    match: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    matchQuarter: { deleteMany: vi.fn(), upsert: vi.fn() },
    player: { findMany: vi.fn() },
    playerMatchStats: { deleteMany: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    matchEvent: { deleteMany: vi.fn(), findMany: vi.fn() },
    scoreFlow: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    teamMatchStats: { deleteMany: vi.fn(), upsert: vi.fn() },
    pollLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return {
    prisma: {
      ...transactionClient,
      $transaction: vi.fn((input: any) => (
        typeof input === 'function' ? input(transactionClient) : Promise.all(input)
      )),
    },
    excludeSimData: {},
  };
});

vi.mock('@/lib/standings', () => ({
  acquireStandingsSourceLock: standingsMocks.acquire,
  rebuildStandingsInTransaction: standingsMocks.rebuild,
}));

const mockMatch = prisma.match as unknown as {
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockMatch.updateMany.mockResolvedValue({ count: 0 });
  vi.mocked(prisma.player.findMany).mockResolvedValue([]);
  vi.mocked(prisma.matchEvent.findMany).mockResolvedValue([]);
  vi.mocked(prisma.pollLog.findMany).mockResolvedValue([]);
  vi.mocked(prisma.pollLog.create).mockResolvedValue({ id: 'final-poll-log' } as never);
  vi.mocked(prisma.pollLog.update).mockResolvedValue({} as never);
  vi.mocked(prisma.pollLog.updateMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(prisma.match.upsert).mockImplementation((async ({ create }: any) => ({
    sourceRetrievedAt: create.sourceRetrievedAt,
  })) as never);
  standingsMocks.acquire.mockResolvedValue(undefined);
  standingsMocks.rebuild.mockResolvedValue(0);
});

describe('applyChanges', () => {
  it('persists corrected detail data when the top-level match state is unchanged', async () => {
    vi.mocked(prisma.player.findMany).mockResolvedValue([
      { id: 'player-1', name: 'Player One', championDataPlayerId: 10, teamId: 'team-1' },
    ] as any);
    vi.mocked(prisma.playerMatchStats.findMany).mockResolvedValue([
      { playerId: 'player-1', goals: 5 },
    ] as any);
    vi.mocked(prisma.scoreFlow.findMany).mockResolvedValue([
      {
        period: 1,
        periodSeconds: 100,
        scoringTeamId: 'team-1',
        homeScore: 1,
        awayScore: 0,
        scorePoints: 1,
      },
    ] as any);

    await applyChanges({
      matchId: 'match-1',
      scoreChanged: false,
      statusChanged: false,
      timeChanged: false,
      newHomeScore: 10,
      newAwayScore: 9,
      newStatus: 'LIVE',
      currentQuarter: 1,
      currentTime: '300',
    }, {
      cdMatchId: 100,
      homeScore: 10,
      awayScore: 9,
      status: 'LIVE',
      currentQuarter: 1,
      currentTime: '300',
      quarterScores: [{ quarter: 1, homeScore: 10, awayScore: 9 }],
      playerStats: [{
        championDataPlayerId: 10,
        goals: 4,
        attempts: 6,
        goalAssists: 1,
        intercepts: 0,
        deflections: 0,
        rebounds: 0,
        penalties: 1,
        feeds: 2,
        centrePassReceives: 1,
        turnovers: 0,
        minutesPlayed: 15,
        goal2: 0,
        attempt2: 0,
        netPoints: 12,
        points: 4,
        goalMisses: 2,
        feedWithAttempt: 1,
        gain: 0,
        pickups: 0,
        contactPenalties: 1,
        obstructionPenalties: 0,
        centrePassToGoalPerc: 50,
        quartersPlayed: 1,
        blocks: 0,
        tossUpWin: 0,
        secondPhaseReceive: 0,
        possessionChanges: 0,
        unforcedTurnovers: 0,
        interceptPassThrown: 0,
      }],
      scoreFlow: [{
        period: 1,
        periodSeconds: 100,
        squadId: 801,
        scorepoints: 2,
        homeScore: 2,
        awayScore: 0,
        scoringTeamPrismaId: 'team-1',
      }],
      teamStats: {
        home: { goals: 10 } as any,
        away: { goals: 9 } as any,
        homeTeamPrismaId: 'team-1',
        awayTeamPrismaId: 'team-2',
      },
    });

    expect(prisma.match.update).not.toHaveBeenCalled();
    expect(prisma.matchQuarter.upsert).toHaveBeenCalled();
    expect(prisma.playerMatchStats.upsert).toHaveBeenCalled();
    expect(prisma.teamMatchStats.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.scoreFlow.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ scorePoints: 2 }),
    }));
  });

  it('does not rewrite unchanged score-flow history on every live poll', async () => {
    vi.mocked(prisma.scoreFlow.findMany).mockResolvedValue([{
      period: 1,
      periodSeconds: 100,
      scoringTeamId: 'team-1',
      homeScore: 2,
      awayScore: 0,
      scorePoints: 2,
    }] as any);

    await applyChanges({
      matchId: 'match-1',
      scoreChanged: false,
      statusChanged: false,
      timeChanged: false,
      newHomeScore: 2,
      newAwayScore: 0,
      newStatus: 'LIVE',
      currentQuarter: 1,
      currentTime: '100',
    }, {
      cdMatchId: 100,
      homeScore: 2,
      awayScore: 0,
      status: 'LIVE',
      currentQuarter: 1,
      currentTime: '100',
      scoreFlow: [{
        period: 1,
        periodSeconds: 100,
        squadId: 801,
        scorepoints: 2,
        homeScore: 2,
        awayScore: 0,
        scoringTeamPrismaId: 'team-1',
      }],
    });

    expect(prisma.scoreFlow.upsert).not.toHaveBeenCalled();
  });

  it('keeps a completed live-detail transition pending until atomic finalization', async () => {
    vi.mocked(prisma.player.findMany).mockResolvedValue([]);

    await applyChanges({
      matchId: 'match-1',
      scoreChanged: true,
      statusChanged: true,
      timeChanged: false,
      newHomeScore: 61,
      newAwayScore: 40,
      newStatus: 'COMPLETED',
      currentQuarter: 4,
      currentTime: '900',
    }, {
      cdMatchId: 100,
      homeScore: 61,
      awayScore: 40,
      status: 'COMPLETED',
      currentQuarter: 4,
      currentTime: '900',
    });

    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        resultQuality: 'PROVISIONAL',
      }),
    });
  });

  it('treats an explicit empty player-stat snapshot as a canonical tombstone', async () => {
    await applyChanges({
      matchId: 'match-1',
      scoreChanged: false,
      statusChanged: false,
      timeChanged: false,
      newHomeScore: 10,
      newAwayScore: 9,
      newStatus: 'LIVE',
      currentQuarter: 1,
      currentTime: '300',
    }, {
      cdMatchId: 100,
      homeScore: 10,
      awayScore: 9,
      status: 'LIVE',
      currentQuarter: 1,
      currentTime: '300',
      playerStats: [],
    });

    expect(prisma.playerMatchStats.deleteMany).toHaveBeenCalledWith({
      where: { matchId: 'match-1' },
    });
  });
});

describe('syncFixtureMatches', () => {
  it('stores finals in the season competition with their source and stage', async () => {
    const observedAt = new Date('2026-07-04T09:00:00.000Z');
    vi.mocked(prisma.competition.findUnique).mockResolvedValue({
      id: 'season-2026',
      stages: [
        { id: 'regular-stage', slug: 'regular-season' },
        { id: 'finals-stage', slug: 'finals' },
      ],
    } as any);
    vi.mocked(prisma.team.findMany).mockResolvedValue([
      { id: 'home', championDataTeamId: 801 },
      { id: 'away', championDataTeamId: 804 },
    ] as any);
    mockMatch.findUnique.mockResolvedValue(null);

    const synced = await syncFixtureMatches([{
      matchId: 129500301,
      roundNumber: 3,
      finalCode: 'GRAND',
      homeSquadId: 801,
      awaySquadId: 804,
      venueName: 'John Cain Arena',
      utcStartTime: '2026-07-04T09:30:00Z',
      matchStatus: 'complete',
      homeSquadScore: 61,
      awaySquadScore: 40,
    } as CDFixtureMatch], 12949, 12950, observedAt);

    expect(synced).toBe(1);
    expect(prisma.match.upsert).toHaveBeenCalledWith({
      where: { championDataMatchId: 129500301 },
      update: {},
      create: expect.objectContaining({
        competitionId: 'season-2026',
        sourceCompetitionId: 12950,
        finalCode: 'GRAND',
        stageId: 'finals-stage',
        roundLabel: 'Round 3',
        sourceRetrievedAt: observedAt,
        championDataMatchId: 129500301,
        status: 'COMPLETED',
        resultQuality: 'PROVISIONAL',
      }),
      select: { sourceRetrievedAt: true },
    });
    expect(prisma.match.updateMany).not.toHaveBeenCalled();
  });

  it('serializes standings-affecting metadata and rebuilds old and new competitions atomically', async () => {
    const previousRevision = new Date('2026-07-04T08:59:00.000Z');
    const observedAt = new Date('2026-07-04T09:00:00.000Z');
    vi.mocked(prisma.competition.findUnique).mockResolvedValue({
      id: 'new-season',
      stages: [{ id: 'regular-stage', slug: 'regular-season' }],
    } as never);
    vi.mocked(prisma.team.findMany).mockResolvedValue([
      { id: 'new-home', championDataTeamId: 801 },
      { id: 'new-away', championDataTeamId: 804 },
    ] as never);
    mockMatch.findUnique.mockResolvedValue({
      id: 'match-1',
      competitionId: 'old-season',
      homeTeamId: 'old-home',
      awayTeamId: 'old-away',
      stageId: 'old-stage',
      finalCode: null,
      status: 'COMPLETED',
      resultQuality: 'OFFICIAL_FINAL',
      sourceRetrievedAt: previousRevision,
    });
    mockMatch.updateMany.mockResolvedValue({ count: 1 });

    await syncFixtureMatches([{
      matchId: 100,
      roundNumber: 2,
      homeSquadId: 801,
      awaySquadId: 804,
      venueName: 'Arena',
      utcStartTime: '2026-07-04T09:30:00Z',
      matchStatus: 'complete',
      finalCode: '',
    } as CDFixtureMatch], 12949, 12949, observedAt);

    expect(standingsMocks.acquire.mock.calls.map(([, id]) => id)).toEqual([
      'new-season',
      'old-season',
    ]);
    expect(mockMatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'match-1', sourceRetrievedAt: previousRevision },
      data: expect.objectContaining({
        competitionId: 'new-season',
        homeTeamId: 'new-home',
        awayTeamId: 'new-away',
        stageId: 'regular-stage',
        sourceRetrievedAt: observedAt,
      }),
    }));
    expect(standingsMocks.rebuild.mock.calls.map(([, id]) => id)).toEqual([
      'new-season',
      'old-season',
    ]);
    expect(mockMatch.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(standingsMocks.rebuild.mock.invocationCallOrder[0]);
  });

  it('does not let an older fixture overwrite a newer accepted metadata revision', async () => {
    const observedAt = new Date('2026-07-04T09:00:00.000Z');
    vi.mocked(prisma.competition.findUnique).mockResolvedValue({
      id: 'season-2026',
      stages: [],
    } as never);
    vi.mocked(prisma.team.findMany).mockResolvedValue([
      { id: 'home', championDataTeamId: 801 },
      { id: 'away', championDataTeamId: 804 },
    ] as never);
    mockMatch.findUnique.mockResolvedValue({
      id: 'match-1', competitionId: 'season-2026', homeTeamId: 'home',
      awayTeamId: 'away', stageId: null, finalCode: null, status: 'SCHEDULED',
      resultQuality: 'UNKNOWN',
      sourceRetrievedAt: new Date('2026-07-04T09:00:01.000Z'),
    });

    const synced = await syncFixtureMatches([{
      matchId: 100, roundNumber: 2, homeSquadId: 801, awaySquadId: 804,
      venueName: 'Stale Arena', utcStartTime: '2026-07-04T09:30:00Z',
      matchStatus: 'scheduled',
    } as CDFixtureMatch], 12949, 12949, observedAt);

    expect(synced).toBe(0);
    expect(mockMatch.updateMany).not.toHaveBeenCalled();
    expect(standingsMocks.rebuild).not.toHaveBeenCalled();
  });
});

describe('finalizeCompletedMatches', () => {
  const fixture = (homeScore = 61, awayScore = 40) => ({
    matchId: 100,
    homeSquadId: 801,
    awaySquadId: 804,
    matchStatus: 'complete',
    homeSquadScore: homeScore,
    awaySquadScore: awayScore,
    period: 4,
  } as CDFixtureMatch);

  const detail = (homeScore = 61, awayScore = 40) => ({
    matchInfo: {
      matchId: 100,
      matchStatus: 'complete',
      homeSquadId: 801,
      awaySquadId: 804,
      homeScore,
      awayScore,
      period: 4,
      periodSeconds: 900,
    },
    periodScores: [{ period: 4, homeScore, awayScore }],
    playerStats: { home: [], away: [] },
    scoreFlow: [],
  } as unknown as CDMatchStatsResponse);

  function pendingMatch(overrides: Record<string, unknown> = {}) {
    return {
      id: 'match-1',
      championDataMatchId: 100,
      sourceCompetitionId: 12949,
      competitionId: 'comp-1',
      status: 'COMPLETED',
      homeScore: 61,
      awayScore: 40,
      currentQuarter: 4,
      resultQuality: 'PROVISIONAL',
      sourceUpdatedAt: null,
      ...overrides,
    };
  }

  function mockEffectiveMatch(overrides: Record<string, unknown> = {}) {
    mockMatch.findUnique.mockImplementation(async (query: { include?: unknown }) => (
      query.include
        ? {
            id: 'match-1',
            homeTeam: { id: 'home', championDataTeamId: 801 },
            awayTeam: { id: 'away', championDataTeamId: 804 },
          }
        : pendingMatch(overrides)
    ));
  }

  it('keeps a failed detail revision pending for a later durable retry', async () => {
    mockMatch.findMany.mockResolvedValue([pendingMatch()]);
    vi.mocked(fetchMatchStats).mockRejectedValueOnce(new Error('provider unavailable'));

    const first = await finalizeCompletedMatches([fixture()], 12949, ['match-1']);

    expect(first).toEqual({ matches: [], failedMatchIds: ['match-1'] });
    expect(mockMatch.update).not.toHaveBeenCalled();

    mockEffectiveMatch();
    vi.mocked(fetchMatchStats).mockResolvedValueOnce(detail());
    const retry = await finalizeCompletedMatches([fixture()], 12949, ['match-1']);

    expect(retry.failedMatchIds).toEqual([]);
    expect(retry.matches).toHaveLength(1);
  });

  it('recovers official-correction intent from a failed durable poll log', async () => {
    mockMatch.findMany.mockResolvedValue([pendingMatch({
      homeScore: 61,
      awayScore: 40,
      resultQuality: 'OFFICIAL_FINAL',
    })]);
    vi.mocked(prisma.pollLog.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ cdMatchId: 100 }] as never);
    vi.mocked(fetchMatchStats).mockRejectedValueOnce(new Error('provider unavailable'));

    const first = await finalizeCompletedMatches(
      [fixture(60, 39)],
      12949,
      ['match-1'],
      ['match-1'],
    );

    expect(first.failedMatchIds).toEqual(['match-1']);
    expect(prisma.pollLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ endpoint: 'final-detail-correction' }),
    }));

    mockEffectiveMatch({
      homeScore: 61,
      awayScore: 40,
      resultQuality: 'OFFICIAL_FINAL',
    });
    vi.mocked(fetchMatchStats).mockResolvedValueOnce(detail(60, 39));
    await finalizeCompletedMatches([fixture(60, 39)], 12949, ['match-1']);

    expect(mockMatch.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ resultQuality: 'CORRECTED' }),
    }));
    expect(prisma.pollLog.updateMany).toHaveBeenCalledWith({
      where: {
        cdMatchId: 100,
        endpoint: 'final-detail-correction',
        status: { in: ['pending', 'fetch_error', 'revision_mismatch'] },
      },
      data: { status: 'superseded' },
    });
  });

  it('atomically accepts a newer downward score and matching final detail revision', async () => {
    mockMatch.findMany.mockResolvedValue([pendingMatch({
      homeScore: 61,
      awayScore: 40,
      resultQuality: 'PROVISIONAL',
    })]);
    mockEffectiveMatch({ homeScore: 61, awayScore: 40 });
    vi.mocked(prisma.matchEvent.findMany).mockResolvedValue([
      { id: 'stale-event', playerId: 'player-1', type: 'intercept' },
    ] as never);
    vi.mocked(fetchMatchStats).mockResolvedValue(detail(60, 39));

    const result = await finalizeCompletedMatches(
      [fixture(60, 39)],
      12949,
      ['match-1'],
      ['match-1'],
    );

    expect(prisma.matchQuarter.deleteMany).toHaveBeenCalled();
    expect(prisma.playerMatchStats.deleteMany).toHaveBeenCalled();
    expect(prisma.matchEvent.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['stale-event'] } },
    });
    expect(prisma.scoreFlow.deleteMany).toHaveBeenCalledWith({ where: { matchId: 'match-1' } });
    expect(mockMatch.update).toHaveBeenCalledWith({
      where: {
        id: 'match-1',
        OR: [
          { sourceUpdatedAt: null },
          { sourceUpdatedAt: { lt: expect.any(Date) } },
        ],
      },
      data: {
        status: 'COMPLETED',
        resultQuality: 'CORRECTED',
        homeScore: 60,
        awayScore: 39,
        currentQuarter: 4,
        currentTime: '900',
        sourceUpdatedAt: expect.any(Date),
      },
    });
    expect(standingsMocks.acquire).toHaveBeenCalledWith(expect.anything(), 'comp-1');
    expect(standingsMocks.rebuild).toHaveBeenCalledWith(expect.anything(), 'comp-1');
    expect(mockMatch.update.mock.invocationCallOrder[0])
      .toBeLessThan(standingsMocks.rebuild.mock.invocationCallOrder[0]);
    expect(result).toEqual({
      matches: [{
        matchId: 'match-1',
        homeScore: 60,
        awayScore: 39,
        finalQuarter: 4,
        sourceUpdatedAt: expect.any(Date),
        standingsChanged: true,
      }],
      failedMatchIds: [],
    });
  });

  it('promotes quality-only finalization and rebuilds standings consistently', async () => {
    mockMatch.findMany.mockResolvedValue([pendingMatch()]);
    mockEffectiveMatch();
    vi.mocked(fetchMatchStats).mockResolvedValue(detail());

    const result = await finalizeCompletedMatches([fixture()], 12949, ['match-1']);

    expect(mockMatch.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ resultQuality: 'OFFICIAL_FINAL' }),
    }));
    expect(standingsMocks.rebuild).toHaveBeenCalledOnce();
    expect(result.matches[0]).toMatchObject({ standingsChanged: true });
  });

  it('does not overwrite canonical final detail from a newer observation', async () => {
    const newer = new Date('2100-01-01T00:00:00.000Z');
    mockMatch.findMany.mockResolvedValue([pendingMatch()]);
    mockEffectiveMatch({
      status: 'COMPLETED',
      resultQuality: 'OFFICIAL_FINAL',
      sourceUpdatedAt: newer,
    });
    vi.mocked(fetchMatchStats).mockResolvedValue(detail());

    const result = await finalizeCompletedMatches([fixture()], 12949, ['match-1']);

    expect(prisma.matchQuarter.upsert).not.toHaveBeenCalled();
    expect(mockMatch.update).not.toHaveBeenCalled();
    expect(standingsMocks.rebuild).not.toHaveBeenCalled();
    expect(result).toEqual({
      matches: [{
        matchId: 'match-1',
        homeScore: 61,
        awayScore: 40,
        finalQuarter: 4,
        sourceUpdatedAt: newer,
        standingsChanged: false,
      }],
      failedMatchIds: [],
    });
  });

  it('rejects a detail response from a different final score revision', async () => {
    mockMatch.findMany.mockResolvedValue([pendingMatch()]);
    vi.mocked(fetchMatchStats).mockResolvedValue(detail(62, 40));

    const result = await finalizeCompletedMatches([fixture()], 12949, ['match-1']);

    expect(mockMatch.update).not.toHaveBeenCalled();
    expect(prisma.matchQuarter.upsert).not.toHaveBeenCalled();
    expect(result).toEqual({ matches: [], failedMatchIds: ['match-1'] });
  });

  it('rejects an equal-score detail snapshot that is not itself complete', async () => {
    mockMatch.findMany.mockResolvedValue([pendingMatch()]);
    vi.mocked(fetchMatchStats).mockResolvedValue({
      ...detail(),
      matchInfo: { ...detail().matchInfo, matchStatus: 'playing' },
    });

    const result = await finalizeCompletedMatches([fixture()], 12949, ['match-1']);

    expect(mockMatch.update).not.toHaveBeenCalled();
    expect(prisma.matchQuarter.upsert).not.toHaveBeenCalled();
    expect(result).toEqual({ matches: [], failedMatchIds: ['match-1'] });
  });

  it('abandons finalization when newer fixture metadata commits during the detail fetch', async () => {
    const accepted = new Date('2026-07-25T09:00:00Z');
    const newer = new Date('2026-07-25T09:00:01Z');
    mockMatch.findMany.mockResolvedValue([pendingMatch({ sourceRetrievedAt: accepted })]);
    mockEffectiveMatch({ sourceRetrievedAt: newer });
    vi.mocked(fetchMatchStats).mockResolvedValue(detail());

    const result = await finalizeCompletedMatches(
      [fixture()],
      12949,
      ['match-1'],
      [],
      new Map([[100, accepted]]),
    );

    expect(prisma.matchQuarter.deleteMany).not.toHaveBeenCalled();
    expect(mockMatch.update).not.toHaveBeenCalled();
    expect(standingsMocks.rebuild).not.toHaveBeenCalled();
    expect(prisma.pollLog.update).toHaveBeenCalledWith({
      where: { id: 'final-poll-log' },
      data: { status: 'superseded' },
    });
    expect(result).toEqual({ matches: [], failedMatchIds: [] });
  });
});

describe('validateMatchData', () => {
  const baseFixture: CDFixtureMatch = {
    matchId: 100,
    matchNumber: 1,
    matchType: 'Regular',
    roundNumber: 1,
    homeSquadId: 801,
    homeSquadName: 'Vixens',
    homeSquadCode: 'VIX',
    homeSquadShortCode: 'VIX',
    homeSquadNickname: 'Vixens',
    homeSquadScore: 60,
    awaySquadId: 804,
    awaySquadName: 'Fever',
    awaySquadCode: 'FEV',
    awaySquadShortCode: 'FEV',
    awaySquadNickname: 'Fever',
    awaySquadScore: 55,
    venue: 'Arena',
    venueName: 'Arena',
    venueId: 1,
    venueCode: 'ARN',
    localStartTime: '2026-04-19T15:00:00',
    utcStartTime: '2026-04-19T05:00:00Z',
    matchStatus: 'playing',
    period: 2,
    periodSecs: 450,
    periodCompleted: 1,
    isNetball2pt: true,
    finalCode: '',
    finalShortCode: '',
  };

  const baseDetail = {
    matchInfo: {
      matchId: 100,
      round: 1,
      venue: 'Arena',
      homeSquadId: 801,
      homeSquadName: 'Vixens',
      awaySquadId: 804,
      awaySquadName: 'Fever',
      homeScore: 60,
      awayScore: 55,
      matchStatus: 'playing',
      period: 2,
      periodSeconds: 450,
    },
    scoreFlow: [],
    teamStats: {
      home: { squadId: 801, goals: 60, attempts: 70, goalAssists: 20, intercepts: 5, deflections: 3, rebounds: 4, penalties: 2, feeds: 40, centrePassReceives: 15, turnovers: 8 },
      away: { squadId: 804, goals: 55, attempts: 65, goalAssists: 18, intercepts: 4, deflections: 2, rebounds: 3, penalties: 1, feeds: 35, centrePassReceives: 12, turnovers: 10 },
    },
    playerStats: { home: [], away: [] },
    periodScores: [{ period: 1, homeScore: 30, awayScore: 25 }],
  } as unknown as CDMatchStatsResponse;

  const dbTeams = new Map([
    [801, { id: 'team-1', name: 'Vixens' }],
    [804, { id: 'team-2', name: 'Fever' }],
  ]);

  const dbPlayers = new Map<number, { id: string; name: string; teamId: string }>();

  it('returns valid for well-formed data', () => {
    const result = validateMatchData(baseFixture, baseDetail, dbTeams, dbPlayers);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns critical error when home team not found in DB', () => {
    const sparseTeams = new Map([[804, { id: 'team-2', name: 'Fever' }]]);
    const result = validateMatchData(baseFixture, baseDetail, sparseTeams, dbPlayers);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('801'));
  });

  it('returns critical error for invalid quarter (period 0)', () => {
    const badDetail = {
      ...baseDetail,
      matchInfo: { ...baseDetail.matchInfo, period: 0 },
    };
    const result = validateMatchData(baseFixture, badDetail, dbTeams, dbPlayers);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('period'));
  });

  it('returns warning for unknown player IDs', () => {
    const detailWithPlayers = {
      ...baseDetail,
      playerStats: {
        home: [{ playerId: 9999, displayName: 'Unknown', position: 'GS', squadId: 801, goals: 5, attempts: 7, goalAssists: 0, intercepts: 0, deflections: 0, rebounds: 0, penalties: 0, feeds: 0, centrePassReceives: 0, turnovers: 0, minutesPlayed: 30 }],
        away: [],
      },
    } as unknown as CDMatchStatsResponse;
    const result = validateMatchData(baseFixture, detailWithPlayers, dbTeams, dbPlayers);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining('9999'));
  });

  it('warns on non-monotonic score flow but still includes data', () => {
    const badScoreFlow = {
      ...baseDetail,
      scoreFlow: [
        { period: 1, periodSeconds: 100, squadId: 801, scorepoints: 1, homeScore: 1, awayScore: 0 },
        { period: 1, periodSeconds: 200, squadId: 801, scorepoints: 1, homeScore: 0, awayScore: 0 },
      ],
    };
    const result = validateMatchData(baseFixture, badScoreFlow, dbTeams, dbPlayers);
    expect(result.valid).toBe(true);
    expect(result.scoreFlowValid).toBe(false);
    expect(result.warnings).toContainEqual(expect.stringContaining('Non-monotonic'));
    expect(result.validatedData?.scoreFlow).toHaveLength(2);
  });

  it('clamps periodSeconds that exceed quarter length', () => {
    const longTime = {
      ...baseDetail,
      matchInfo: { ...baseDetail.matchInfo, periodSeconds: 1200 },
    };
    const result = validateMatchData(baseFixture, longTime, dbTeams, dbPlayers);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining('clamp'));
    expect(result.validatedData!.currentTime).toBe('960');
  });

  it('distinguishes an omitted player-stat collection from an empty tombstone', () => {
    const detailWithoutPlayerStats = { ...baseDetail } as Record<string, unknown>;
    Reflect.deleteProperty(detailWithoutPlayerStats, 'playerStats');
    const result = validateMatchData(
      baseFixture,
      detailWithoutPlayerStats as unknown as CDMatchStatsResponse,
      dbTeams,
      dbPlayers,
    );

    expect(result.validatedData?.playerStats).toBeUndefined();
  });
});

describe('reconcileStaleCompletedScores', () => {
  // Minimal fixture entry carrying only the fields the function reads.
  function fixtureEntry(
    matchId: number,
    homeSquadScore: number,
    awaySquadScore: number,
    matchStatus = 'complete',
  ): CDFixtureMatch {
    return { matchId, homeSquadScore, awaySquadScore, matchStatus } as CDFixtureMatch;
  }

  function storedMatch(overrides: Record<string, unknown> = {}) {
    return {
      id: 'm1',
      championDataMatchId: 100,
      competitionId: 'comp-1',
      homeScore: 64,
      awayScore: 64,
      currentQuarter: 4,
      resultQuality: 'UNOFFICIAL_FINAL',
      ...overrides,
    };
  }

  it('keeps a non-public stale score untouched until matching detail is available', async () => {
    mockMatch.findMany.mockResolvedValue([
      storedMatch(),
    ]);

    const result = await reconcileStaleCompletedScores([fixtureEntry(100, 66, 64)]);

    expect(mockMatch.updateMany).not.toHaveBeenCalled();
    expect(standingsMocks.rebuild).not.toHaveBeenCalled();
    expect(result).toEqual([{
      matchId: 'm1',
      homeScore: 66,
      awayScore: 64,
      finalQuarter: 4,
      wasCorrection: false,
    }]);
  });

  it('keeps the previous official revision until a downward correction commits atomically', async () => {
    mockMatch.findMany.mockResolvedValue([storedMatch({
      homeScore: 60,
      awayScore: 59,
      resultQuality: 'OFFICIAL_FINAL',
    })]);
    const result = await reconcileStaleCompletedScores([fixtureEntry(100, 59, 59)]);
    const retry = await reconcileStaleCompletedScores([fixtureEntry(100, 59, 59)]);

    expect(mockMatch.updateMany).not.toHaveBeenCalled();
    expect(standingsMocks.acquire).not.toHaveBeenCalled();
    expect(standingsMocks.rebuild).not.toHaveBeenCalled();
    expect(result).toEqual([{
      matchId: 'm1',
      homeScore: 59,
      awayScore: 59,
      finalQuarter: 4,
      wasCorrection: true,
    }]);
    expect(retry).toEqual(result);
  });

  it('does not update matches whose score already matches the fixture', async () => {
    mockMatch.findMany.mockResolvedValue([storedMatch({
      homeScore: 70,
      awayScore: 48,
      resultQuality: 'OFFICIAL_FINAL',
    })]);

    const result = await reconcileStaleCompletedScores([fixtureEntry(100, 70, 48)]);

    expect(mockMatch.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('returns a quality-only promotion for atomic detail finalization', async () => {
    mockMatch.findMany.mockResolvedValue([storedMatch({
      homeScore: 70,
      awayScore: 48,
      resultQuality: 'PROVISIONAL',
    })]);

    const result = await reconcileStaleCompletedScores([
      fixtureEntry(100, 70, 48),
    ]);

    expect(mockMatch.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual([{
      matchId: 'm1',
      homeScore: 70,
      awayScore: 48,
      finalQuarter: 4,
      wasCorrection: false,
    }]);
  });

  it('ignores fixture entries that are not yet complete', async () => {
    mockMatch.findMany.mockResolvedValue([
      storedMatch({ homeScore: 30, awayScore: 28 }),
    ]);

    const result = await reconcileStaleCompletedScores([
      fixtureEntry(100, 40, 35, 'playing'),
    ]);

    expect(mockMatch.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('skips matches with no matching fixture entry', async () => {
    mockMatch.findMany.mockResolvedValue([
      storedMatch({ championDataMatchId: 999, homeScore: 50, awayScore: 40 }),
    ]);

    const result = await reconcileStaleCompletedScores([fixtureEntry(100, 66, 64)]);

    expect(mockMatch.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('returns empty when there are no completed matches', async () => {
    mockMatch.findMany.mockResolvedValue([]);

    const result = await reconcileStaleCompletedScores([fixtureEntry(100, 66, 64)]);

    expect(mockMatch.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('does not derive a correction from a superseded fixture metadata token', async () => {
    const accepted = new Date('2026-07-25T09:00:00Z');
    mockMatch.findMany.mockResolvedValue([storedMatch({
      sourceRetrievedAt: new Date('2026-07-25T09:00:01Z'),
      sourceUpdatedAt: null,
      homeScore: 61,
      awayScore: 40,
      resultQuality: 'OFFICIAL_FINAL',
    })]);

    const result = await reconcileStaleCompletedScores(
      [fixtureEntry(100, 60, 39)],
      new Map([[100, accepted]]),
    );

    expect(result).toEqual([]);
  });
});

describe('reconcileCompletedMatches', () => {
  it('marks the match pending without letting an older fixture regress the live score', async () => {
    mockMatch.findMany.mockResolvedValue([{
      id: 'm1',
      status: 'LIVE',
      championDataMatchId: 100,
      homeScore: 60,
      awayScore: 59,
    }]);
    mockMatch.findUnique.mockResolvedValue({
      status: 'LIVE',
      homeScore: 60,
      awayScore: 59,
      currentQuarter: 4,
    });
    mockMatch.updateMany.mockResolvedValue({ count: 1 });

    const result = await reconcileCompletedMatches([{
      matchId: 100,
      matchStatus: 'complete',
      homeSquadScore: 59,
      awaySquadScore: 59,
      period: 4,
    } as CDFixtureMatch]);

    expect(mockMatch.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'm1',
        status: { in: ['LIVE', 'SCHEDULED'] },
      },
      data: {
        status: 'COMPLETED',
        resultQuality: 'PROVISIONAL',
      },
    });
    expect(mockMatch.update).not.toHaveBeenCalled();
    expect(result).toEqual([{
      matchId: 'm1',
      homeScore: 60,
      awayScore: 59,
      finalQuarter: 4,
    }]);
  });

  it('rejects a fixture-only completion older than the committed detail revision', async () => {
    const fixtureObservedAt = new Date('2026-07-25T09:00:00Z');
    mockMatch.findMany.mockResolvedValue([{
      id: 'm1',
      status: 'LIVE',
      championDataMatchId: 100,
      homeScore: 60,
      awayScore: 59,
      sourceUpdatedAt: new Date('2026-07-25T09:00:01Z'),
    }]);

    const result = await reconcileCompletedMatches([{
      matchId: 100,
      matchStatus: 'complete',
      homeSquadScore: 59,
      awaySquadScore: 59,
      period: 4,
    } as CDFixtureMatch], new Map([[100, fixtureObservedAt]]));

    expect(mockMatch.findUnique).not.toHaveBeenCalled();
    expect(mockMatch.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('rejects an interleaved completion when the exact fixture metadata token changed', async () => {
    const accepted = new Date('2026-07-25T09:00:00Z');
    mockMatch.findMany.mockResolvedValue([{
      id: 'm1', status: 'LIVE', championDataMatchId: 100,
      homeScore: 60, awayScore: 59, sourceRetrievedAt: accepted,
      sourceUpdatedAt: null,
    }]);
    mockMatch.findUnique.mockResolvedValue({
      status: 'LIVE', homeScore: 60, awayScore: 59, currentQuarter: 4,
      sourceRetrievedAt: new Date('2026-07-25T09:00:01Z'), sourceUpdatedAt: null,
    });

    const result = await reconcileCompletedMatches([{
      matchId: 100, matchStatus: 'complete', homeSquadScore: 60,
      awaySquadScore: 59, period: 4,
    } as CDFixtureMatch], new Map([[100, accepted]]));

    expect(mockMatch.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
