import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const glasgowFeedMocks = vi.hoisted(() => ({
  syncOfficialGlasgowResults: vi.fn().mockResolvedValue({
    status: 'empty' as const,
    matchesProcessed: 0,
  }),
}));

vi.mock('@/lib/db', () => {
  const transactionClient = {
    playerMatchStats: { findMany: vi.fn() },
    match: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    pollLog: {
      findUnique: vi.fn().mockResolvedValue({ polledAt: new Date('2026-06-01T00:00:00Z') }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  return {
    prisma: {
      team: { findMany: vi.fn() },
      player: { findMany: vi.fn() },
      playerMatchStats: transactionClient.playerMatchStats,
      match: transactionClient.match,
      pollLog: { ...transactionClient.pollLog, update: vi.fn() },
      $transaction: vi.fn((callback: (tx: object) => unknown) => callback(transactionClient)),
    },
    excludeSimData: {},
  };
});

vi.mock('@/lib/live-state', () => ({
  getLiveState: vi.fn(),
}));

vi.mock('@/lib/ingestion', () => ({
  ingestFromChampionData: vi.fn(),
}));

vi.mock('@/lib/glasgow/official-feed-sync', () => glasgowFeedMocks);

vi.mock('@/lib/processing', () => ({
  validateMatchData: vi.fn(),
  syncFixtureMatches: vi.fn().mockResolvedValue(0),
  detectChanges: vi.fn(),
  applyChanges: vi.fn(),
  reconcileCompletedMatches: vi.fn(),
  reconcileStaleCompletedScores: vi.fn().mockResolvedValue([]),
  detectStaleCompletedMatches: vi.fn(),
  finalizeCompletedMatches: vi.fn().mockResolvedValue({ matches: [], failedMatchIds: [] }),
}));

vi.mock('@/lib/broadcasting', () => ({
  broadcastMatchChanges: vi.fn().mockResolvedValue(undefined),
  broadcastPlayerStats: vi.fn().mockResolvedValue(undefined),
  persistStatEvents: vi.fn().mockResolvedValue([]),
  broadcastPersistedStatEvents: vi.fn().mockResolvedValue(undefined),
  broadcastScoreFlowDelta: vi.fn().mockResolvedValue(undefined),
  broadcastCompletion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccess: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/standings', () => ({
  acquireStandingsSourceLock: vi.fn().mockResolvedValue(undefined),
  rebuildStandingsInTransaction: vi.fn().mockResolvedValue(0),
}));

vi.mock('@/lib/worker-health', () => ({
  beginPoll: vi.fn(),
  recordPoll: vi.fn(),
  setCurrentInterval: vi.fn(),
}));

describe('Worker', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Most worker unit tests exercise one source; a dedicated test below covers finals.
    vi.stubEnv('SSN_FINALS_COMPETITION_ID', '12949');
    vi.stubEnv('GLASGOW_LIVE_FEED_ENABLED', '');
    const { prisma } = await import('@/lib/db');
    const processing = await import('@/lib/processing');
    vi.mocked(prisma.team.findMany).mockResolvedValue([]);
    vi.mocked(prisma.player.findMany).mockResolvedValue([]);
    vi.mocked(prisma.playerMatchStats.findMany).mockResolvedValue([]);
    vi.mocked(prisma.match.findMany).mockResolvedValue([]);
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      id: 'db-match',
      competitionId: 'comp-1',
      resultQuality: 'UNKNOWN',
      sourceRetrievedAt: new Date('2026-06-01T00:00:00Z'),
      sourceUpdatedAt: null,
      status: 'LIVE',
      homeScore: 10,
      awayScore: 9,
      currentQuarter: 1,
      currentTime: '300',
      round: 1,
      homeTeamId: 'home',
      awayTeamId: 'away',
      homeTeam: { id: 'home' },
      awayTeam: { id: 'away' },
    } as never);
    vi.mocked(prisma.match.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.pollLog.findUnique).mockResolvedValue({
      polledAt: new Date('2026-06-01T00:00:00Z'),
    } as never);
    vi.mocked(processing.syncFixtureMatches).mockResolvedValue(0);
    vi.mocked(processing.reconcileCompletedMatches).mockResolvedValue([]);
    vi.mocked(processing.reconcileStaleCompletedScores).mockResolvedValue([]);
    vi.mocked(processing.detectStaleCompletedMatches).mockResolvedValue([]);
    vi.mocked(processing.finalizeCompletedMatches).mockResolvedValue({
      matches: [],
      failedMatchIds: [],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should export getPollingInterval function', async () => {
    vi.stubEnv('SIMULATION_MODE', '');
    const { getPollingInterval } = await import('@/lib/worker');
    expect(typeof getPollingInterval).toBe('function');
  });

  it('should return 30s for live matches', async () => {
    vi.stubEnv('SIMULATION_MODE', '');
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(true, true, false)).toBe(30_000);
  });

  it('should return 1min for pre-match', async () => {
    vi.stubEnv('SIMULATION_MODE', '');
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(false, false, true)).toBe(60_000);
  });

  it('should return 2min for match day with no live match', async () => {
    vi.stubEnv('SIMULATION_MODE', '');
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(false, true, false)).toBe(120_000);
  });

  it('should return 1h for off-season', async () => {
    vi.stubEnv('SIMULATION_MODE', '');
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(false, false, false)).toBe(3_600_000);
  });

  it('should return 2s when SIMULATION_MODE is true', async () => {
    vi.stubEnv('SIMULATION_MODE', 'true');
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(true, true, false)).toBe(2_000);
  });

  it('records one Champion Data outcome when the Glasgow feed is disabled', async () => {
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const { recordPoll } = await import('@/lib/worker-health');
    const { pollAllSources } = await import('@/lib/worker');
    vi.mocked(ingestFromChampionData).mockResolvedValue({
      fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
      fixture: [],
      matchDetails: new Map(),
      pollLogIds: [],
      matchPollLogIds: new Map(),
      detailFetchErrors: 0,
    });

    const outcome = await pollAllSources();

    expect(glasgowFeedMocks.syncOfficialGlasgowResults).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: 'empty', matchesProcessed: 0 });
    expect(recordPoll).toHaveBeenCalledOnce();
    expect(recordPoll).toHaveBeenCalledWith('empty', 0);
  });

  it('aggregates a successful enabled Glasgow sync into one health record', async () => {
    vi.stubEnv('GLASGOW_LIVE_FEED_ENABLED', 'true');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const { beginPoll, recordPoll } = await import('@/lib/worker-health');
    const { pollAllSources } = await import('@/lib/worker');
    vi.mocked(ingestFromChampionData).mockResolvedValue({
      fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
      fixture: [],
      matchDetails: new Map(),
      pollLogIds: [],
      matchPollLogIds: new Map(),
      detailFetchErrors: 0,
    });
    glasgowFeedMocks.syncOfficialGlasgowResults.mockResolvedValue({
      status: 'success',
      matchesProcessed: 2,
    });

    const outcome = await pollAllSources();

    expect(outcome).toEqual({ status: 'success', matchesProcessed: 2 });
    expect(beginPoll).toHaveBeenCalledOnce();
    expect(recordPoll).toHaveBeenCalledOnce();
    expect(recordPoll).toHaveBeenCalledWith('success', 2);
    expect(vi.mocked(beginPoll).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ingestFromChampionData).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(beginPoll).mock.invocationCallOrder[0]).toBeLessThan(
      glasgowFeedMocks.syncOfficialGlasgowResults.mock.invocationCallOrder[0]!,
    );
  });

  it('does not overlap Glasgow database work with Champion Data', async () => {
    vi.stubEnv('GLASGOW_LIVE_FEED_ENABLED', 'true');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const { recordPoll } = await import('@/lib/worker-health');
    const { pollAllSources } = await import('@/lib/worker');
    let releaseChampionData!: () => void;
    const championDataGate = new Promise<void>((resolve) => {
      releaseChampionData = resolve;
    });
    vi.mocked(ingestFromChampionData).mockImplementationOnce(async () => {
      await championDataGate;
      return {
        fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
        fixture: [],
        matchDetails: new Map(),
        pollLogIds: [],
        matchPollLogIds: new Map(),
        detailFetchErrors: 0,
      };
    });
    glasgowFeedMocks.syncOfficialGlasgowResults.mockResolvedValue({
      status: 'success',
      matchesProcessed: 2,
    });

    const pollPromise = pollAllSources();

    await vi.waitFor(() => {
      expect(ingestFromChampionData).toHaveBeenCalledOnce();
    });
    expect(glasgowFeedMocks.syncOfficialGlasgowResults).not.toHaveBeenCalled();
    expect(recordPoll).not.toHaveBeenCalled();

    releaseChampionData();
    await expect(pollPromise).resolves.toEqual({
      status: 'success',
      matchesProcessed: 2,
    });
    expect(glasgowFeedMocks.syncOfficialGlasgowResults).toHaveBeenCalledOnce();
    expect(recordPoll).toHaveBeenCalledOnce();
    expect(recordPoll).toHaveBeenCalledWith('success', 2);
  });

  it('enables Glasgow automatically for the production worker', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WORKER_ENABLED', 'true');
    vi.stubEnv('DATABASE_ENVIRONMENT', 'production');
    vi.stubEnv('IS_PULL_REQUEST', 'false');
    vi.stubEnv('GLASGOW_LIVE_FEED_ENABLED', '');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const { pollAllSources } = await import('@/lib/worker');
    vi.mocked(ingestFromChampionData).mockResolvedValue({
      fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
      fixture: [],
      matchDetails: new Map(),
      pollLogIds: [],
      matchPollLogIds: new Map(),
      detailFetchErrors: 0,
    });
    glasgowFeedMocks.syncOfficialGlasgowResults.mockResolvedValue({
      status: 'empty',
      matchesProcessed: 0,
    });

    await pollAllSources();

    expect(glasgowFeedMocks.syncOfficialGlasgowResults).toHaveBeenCalledOnce();
  });

  it('does not default-enable Glasgow for a production-built preview worker', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WORKER_ENABLED', 'true');
    vi.stubEnv('DATABASE_ENVIRONMENT', 'production');
    vi.stubEnv('IS_PULL_REQUEST', 'true');
    vi.stubEnv('GLASGOW_LIVE_FEED_ENABLED', 'true');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const { pollAllSources } = await import('@/lib/worker');
    vi.mocked(ingestFromChampionData).mockResolvedValue({
      fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
      fixture: [],
      matchDetails: new Map(),
      pollLogIds: [],
      matchPollLogIds: new Map(),
      detailFetchErrors: 0,
    });

    await pollAllSources();

    expect(glasgowFeedMocks.syncOfficialGlasgowResults).not.toHaveBeenCalled();
  });

  it('does not hide a thrown Glasgow failure behind Champion Data success', async () => {
    vi.stubEnv('GLASGOW_LIVE_FEED_ENABLED', 'true');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const { recordPoll } = await import('@/lib/worker-health');
    const { pollAllSources } = await import('@/lib/worker');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(ingestFromChampionData).mockResolvedValue({
      fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
      fixture: [{ matchId: 101 } as never],
      matchDetails: new Map(),
      pollLogIds: [],
      matchPollLogIds: new Map(),
      detailFetchErrors: 0,
    });
    glasgowFeedMocks.syncOfficialGlasgowResults.mockRejectedValue(
      new Error('failed at https://worker:not-a-real-secret@official.example/results'),
    );

    const outcome = await pollAllSources();

    expect(outcome).toEqual({ status: 'error', matchesProcessed: 0 });
    expect(recordPoll).toHaveBeenCalledOnce();
    expect(recordPoll).toHaveBeenCalledWith('error', 0);
    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('https://[redacted]@official.example/results');
    expect(logged).not.toContain('not-a-real-secret');
    errorSpy.mockRestore();
  });

  it('redacts credential-bearing URLs from ingestion errors', async () => {
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const { pollChampionData } = await import('@/lib/worker');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(ingestFromChampionData).mockRejectedValue(
      new Error('request failed at https://worker:not-a-real-secret@upstream.example/data'),
    );

    await pollChampionData();

    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('https://[redacted]@upstream.example/data');
    expect(logged).not.toContain('not-a-real-secret');
    errorSpy.mockRestore();
  });

  it('serializes overlapping work for the same match', async () => {
    const { withMatchProcessingLock } = await import('@/lib/worker');
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withMatchProcessingLock('match-1', async () => {
      order.push('first-start');
      await firstGate;
      order.push('first-end');
    });
    await vi.waitFor(() => expect(order).toEqual(['first-start']));

    const second = withMatchProcessingLock('match-1', async () => {
      order.push('second-start');
      order.push('second-end');
    });
    await Promise.resolve();
    expect(order).toEqual(['first-start']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });

  it('persists unchanged-state corrections and updates each match PollLog', async () => {
    const { prisma } = await import('@/lib/db');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const processing = await import('@/lib/processing');
    const { pollChampionData } = await import('@/lib/worker');

    vi.mocked(ingestFromChampionData).mockResolvedValue({
      fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
      fixture: [
        { matchId: 101 } as any,
        { matchId: 102 } as any,
      ],
      matchDetails: new Map([
        [101, { matchInfo: { matchId: 101 } } as any],
        [102, { matchInfo: { matchId: 102 } } as any],
      ]),
      pollLogIds: ['fixture-log', 'match-101-log', 'match-102-log'],
      matchPollLogIds: new Map([
        [101, 'match-101-log'],
        [102, 'match-102-log'],
      ]),
      detailFetchErrors: 0,
    });
    vi.mocked(prisma.team.findMany).mockResolvedValue([]);
    vi.mocked(prisma.player.findMany).mockResolvedValue([]);
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      id: 'db-match',
      competitionId: 'comp-1',
      resultQuality: 'UNKNOWN',
      sourceRetrievedAt: new Date('2026-06-01T00:00:00Z'),
      sourceUpdatedAt: null,
      status: 'LIVE',
      homeScore: 10,
      awayScore: 9,
      currentQuarter: 1,
      currentTime: '300',
      homeTeam: {},
      awayTeam: {},
    } as any);
    vi.mocked(processing.validateMatchData).mockImplementation((fixture: any) => ({
      valid: true,
      scoreFlowValid: true,
      warnings: [],
      errors: [],
      validatedData: {
        cdMatchId: fixture.matchId,
        homeScore: 10,
        awayScore: 9,
        status: 'LIVE',
        currentQuarter: 1,
        currentTime: '300',
        quarterScores: [{ quarter: 1, homeScore: 10, awayScore: 9 }],
      },
    }));
    vi.mocked(processing.detectChanges).mockImplementation(async (incoming) => ({
      matchId: `db-${incoming.cdMatchId}`,
      scoreChanged: false,
      statusChanged: false,
      timeChanged: false,
      newHomeScore: incoming.homeScore,
      newAwayScore: incoming.awayScore,
      newStatus: incoming.status,
      currentQuarter: incoming.currentQuarter,
      currentTime: incoming.currentTime,
    }));
    vi.mocked(processing.applyChanges).mockResolvedValue(new Map());
    vi.mocked(processing.reconcileCompletedMatches).mockResolvedValue([]);
    vi.mocked(processing.detectStaleCompletedMatches).mockResolvedValue([]);
    vi.mocked(processing.finalizeCompletedMatches).mockResolvedValue({ matches: [], failedMatchIds: [] });
    vi.mocked(processing.reconcileStaleCompletedScores).mockResolvedValue([]);

    await pollChampionData();

    expect(processing.applyChanges).toHaveBeenCalledTimes(2);
    expect(prisma.pollLog.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'match-101-log' },
      data: expect.objectContaining({ status: 'processed' }),
    }));
    expect(prisma.pollLog.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'match-102-log' },
      data: expect.objectContaining({ status: 'processed' }),
    }));
  });

  it('records partial health when any required match detail fetch fails', async () => {
    const { prisma } = await import('@/lib/db');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const processing = await import('@/lib/processing');
    const { recordPoll } = await import('@/lib/worker-health');
    const { pollChampionData } = await import('@/lib/worker');

    vi.mocked(ingestFromChampionData).mockResolvedValue({
      fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
      fixture: [{ matchId: 101 } as any],
      matchDetails: new Map(),
      pollLogIds: ['fixture-log'],
      matchPollLogIds: new Map(),
      detailFetchErrors: 1,
    });
    vi.mocked(prisma.team.findMany).mockResolvedValue([]);
    vi.mocked(prisma.player.findMany).mockResolvedValue([]);
    vi.mocked(processing.reconcileCompletedMatches).mockResolvedValue([]);
    vi.mocked(processing.detectStaleCompletedMatches).mockResolvedValue([]);
    vi.mocked(processing.finalizeCompletedMatches).mockResolvedValue({ matches: [], failedMatchIds: [] });
    vi.mocked(processing.reconcileStaleCompletedScores).mockResolvedValue([]);

    await pollChampionData();

    expect(recordPoll).toHaveBeenCalledWith('partial', 0);
  });

  it('syncs both the regular-season and finals fixtures into one season', async () => {
    vi.stubEnv('SSN_FINALS_COMPETITION_ID', '12950');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const processing = await import('@/lib/processing');
    const { prisma } = await import('@/lib/db');
    const { pollChampionData } = await import('@/lib/worker');

    vi.mocked(ingestFromChampionData)
      .mockResolvedValueOnce({
        fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
        fixture: [{ matchId: 101 } as any],
        matchDetails: new Map(),
        pollLogIds: [],
        matchPollLogIds: new Map(),
        detailFetchErrors: 0,
      })
      .mockResolvedValueOnce({
        fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
        fixture: [{ matchId: 201, finalCode: 'SEMI' } as any],
        matchDetails: new Map(),
        pollLogIds: [],
        matchPollLogIds: new Map(),
        detailFetchErrors: 0,
      });
    vi.mocked(prisma.team.findMany).mockResolvedValue([]);
    vi.mocked(prisma.player.findMany).mockResolvedValue([]);
    vi.mocked(processing.reconcileCompletedMatches).mockResolvedValue([]);
    vi.mocked(processing.detectStaleCompletedMatches).mockResolvedValue([]);
    vi.mocked(processing.finalizeCompletedMatches).mockResolvedValue({ matches: [], failedMatchIds: [] });
    vi.mocked(processing.reconcileStaleCompletedScores).mockResolvedValue([]);

    await pollChampionData();

    expect(ingestFromChampionData).toHaveBeenNthCalledWith(1, 12949);
    expect(ingestFromChampionData).toHaveBeenNthCalledWith(2, 12950);
    expect(processing.syncFixtureMatches).toHaveBeenNthCalledWith(
      1,
      [{ matchId: 101 }],
      12949,
      12949,
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(processing.syncFixtureMatches).toHaveBeenNthCalledWith(
      2,
      [{ matchId: 201, finalCode: 'SEMI' }],
      12949,
      12950,
      new Date('2026-06-01T00:00:00Z'),
    );
  });

  it('awaits completion broadcasts before a poll resolves', async () => {
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const processing = await import('@/lib/processing');
    const { prisma } = await import('@/lib/db');
    const { broadcastCompletion } = await import('@/lib/broadcasting');
    const { pollChampionData } = await import('@/lib/worker');
    let release!: () => void;

    vi.mocked(ingestFromChampionData).mockResolvedValue({
      fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
      fixture: [{ matchId: 101 } as never],
      matchDetails: new Map(),
      pollLogIds: [],
      matchPollLogIds: new Map(),
      detailFetchErrors: 0,
    });
    vi.mocked(prisma.team.findMany).mockResolvedValue([]);
    vi.mocked(prisma.player.findMany).mockResolvedValue([]);
    vi.mocked(processing.reconcileCompletedMatches).mockResolvedValue([
      { matchId: 'completed-1', homeScore: 60, awayScore: 59, finalQuarter: 4 },
    ] as never);
    vi.mocked(processing.detectStaleCompletedMatches).mockResolvedValue([]);
    vi.mocked(processing.finalizeCompletedMatches).mockResolvedValue({
      matches: [{
        matchId: 'completed-1',
        homeScore: 60,
        awayScore: 59,
        finalQuarter: 4,
        sourceUpdatedAt: new Date('2026-06-01T00:00:00Z'),
        standingsChanged: true,
      }],
      failedMatchIds: [],
    });
    vi.mocked(processing.reconcileStaleCompletedScores).mockResolvedValue([]);
    vi.mocked(broadcastCompletion).mockReturnValue(new Promise<void>((resolve) => {
      release = resolve;
    }));

    let pollSettled = false;
    const poll = pollChampionData().then(() => { pollSettled = true; });
    await vi.waitFor(() => expect(broadcastCompletion).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(pollSettled).toBe(false);

    release();
    await poll;
    expect(pollSettled).toBe(true);
  });

  it('commits inferred events before aggregate updates and any realtime broadcast', async () => {
    const { prisma } = await import('@/lib/db');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const processing = await import('@/lib/processing');
    const broadcasting = await import('@/lib/broadcasting');
    const { pollChampionData } = await import('@/lib/worker');

    vi.mocked(ingestFromChampionData).mockResolvedValue({
      fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
      fixture: [{ matchId: 101 } as never],
      matchDetails: new Map([[101, {
        playerStats: {
          home: [{ playerId: 10, intercepts: 1 }],
          away: [],
        },
      } as never]]),
      pollLogIds: [],
      matchPollLogIds: new Map([[101, 'match-101-log']]),
      detailFetchErrors: 0,
    });
    vi.mocked(prisma.team.findMany).mockResolvedValue([]);
    vi.mocked(prisma.player.findMany).mockResolvedValue([]);
    vi.mocked(prisma.playerMatchStats.findMany).mockResolvedValue([]);
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      id: 'db-match',
      sourceRetrievedAt: new Date('2026-06-01T00:00:00Z'),
      sourceUpdatedAt: null,
      round: 1,
      homeTeamId: 'home',
      awayTeamId: 'away',
      homeTeam: { id: 'home' },
      awayTeam: { id: 'away' },
    } as never);
    vi.mocked(processing.validateMatchData).mockReturnValue({
      valid: true,
      scoreFlowValid: true,
      warnings: [],
      errors: [],
      validatedData: {
        cdMatchId: 101,
        homeScore: 10,
        awayScore: 9,
        status: 'LIVE',
        currentQuarter: 1,
        currentTime: '300',
        quarterScores: [],
      },
    } as never);
    vi.mocked(processing.detectChanges).mockResolvedValue({
      matchId: 'db-match',
      scoreChanged: true,
      statusChanged: false,
      timeChanged: false,
      newHomeScore: 10,
      newAwayScore: 9,
      newStatus: 'LIVE',
      currentQuarter: 1,
      currentTime: '300',
    });
    vi.mocked(broadcasting.persistStatEvents).mockResolvedValue([{
      eventId: 'event-1',
      matchId: 'db-match',
      type: 'intercept',
      playerId: 'player-1',
      playerName: 'Player One',
      teamId: 'home',
      teamName: 'Home',
      teamAbbreviation: 'HOM',
      isHomeTeam: true,
      quarter: 1,
      time: '300',
    }]);
    vi.mocked(processing.applyChanges).mockResolvedValue(new Map());
    vi.mocked(processing.reconcileCompletedMatches).mockResolvedValue([]);
    vi.mocked(processing.detectStaleCompletedMatches).mockResolvedValue([]);
    vi.mocked(processing.finalizeCompletedMatches).mockResolvedValue({ matches: [], failedMatchIds: [] });
    vi.mocked(processing.reconcileStaleCompletedScores).mockResolvedValue([]);

    await pollChampionData();

    const persistOrder = vi.mocked(broadcasting.persistStatEvents).mock.invocationCallOrder[0];
    expect(persistOrder).toBeLessThan(vi.mocked(processing.applyChanges).mock.invocationCallOrder[0]);
    expect(persistOrder).toBeLessThan(vi.mocked(broadcasting.broadcastMatchChanges).mock.invocationCallOrder[0]);
    expect(persistOrder).toBeLessThan(vi.mocked(broadcasting.broadcastPersistedStatEvents).mock.invocationCallOrder[0]);
    const transactionClient = expect.objectContaining({
      match: expect.anything(),
      playerMatchStats: expect.anything(),
    });
    expect(broadcasting.persistStatEvents).toHaveBeenCalledWith(
      'db-match',
      expect.anything(),
      expect.anything(),
      expect.any(Map),
      1,
      300,
      transactionClient,
    );
    expect(processing.applyChanges).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      transactionClient,
    );
    expect(prisma.match.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'db-match',
        sourceRetrievedAt: new Date('2026-06-01T00:00:00Z'),
        OR: [
          { sourceUpdatedAt: null },
          { sourceUpdatedAt: { lt: new Date('2026-06-01T00:00:00Z') } },
        ],
      },
      data: { sourceUpdatedAt: new Date('2026-06-01T00:00:00Z') },
    });
  });

  it('accepts a newer downward correction without letting one stat veto score or clock, then continues', async () => {
    const { prisma } = await import('@/lib/db');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const processing = await import('@/lib/processing');
    const broadcasting = await import('@/lib/broadcasting');
    const { pollChampionData } = await import('@/lib/worker');

    vi.mocked(ingestFromChampionData)
      .mockResolvedValueOnce({
        fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
        fixture: [{ matchId: 101 } as never],
        matchDetails: new Map([[101, {
          playerStats: {
            home: [{ playerId: 10, intercepts: 1, deflections: 0, rebounds: 0, turnovers: 0 }],
            away: [],
          },
        } as never]]),
        pollLogIds: [],
        matchPollLogIds: new Map([[101, 'correction-observation']]),
        detailFetchErrors: 0,
      })
      .mockResolvedValueOnce({
        fixtureObservationAt: new Date('2026-06-01T00:00:01Z'),
        fixture: [{ matchId: 101 } as never],
        matchDetails: new Map([[101, {
          playerStats: {
            home: [{ playerId: 10, intercepts: 2, deflections: 0, rebounds: 0, turnovers: 0 }],
            away: [],
          },
        } as never]]),
        pollLogIds: [],
        matchPollLogIds: new Map([[101, 'continuation-observation']]),
        detailFetchErrors: 0,
      });
    vi.mocked(prisma.team.findMany).mockResolvedValue([]);
    vi.mocked(prisma.player.findMany).mockResolvedValue([]);
    vi.mocked(prisma.match.findUnique)
      .mockResolvedValueOnce({
        id: 'db-match',
        competitionId: 'comp-1',
        resultQuality: 'UNKNOWN',
        sourceRetrievedAt: new Date('2026-06-01T00:00:00Z'),
        sourceUpdatedAt: new Date('2026-05-31T23:59:00Z'),
        status: 'LIVE',
        homeScore: 10,
        awayScore: 9,
        currentQuarter: 2,
        currentTime: '400',
        round: 1,
        homeTeamId: 'home',
        awayTeamId: 'away',
        homeTeam: { id: 'home' },
        awayTeam: { id: 'away' },
      } as never)
      .mockResolvedValueOnce({
        id: 'db-match',
        competitionId: 'comp-1',
        resultQuality: 'UNKNOWN',
        sourceRetrievedAt: new Date('2026-06-01T00:00:01Z'),
        sourceUpdatedAt: new Date('2026-06-01T00:00:00Z'),
        status: 'LIVE',
        homeScore: 8,
        awayScore: 7,
        currentQuarter: 2,
        currentTime: '300',
        round: 1,
        homeTeamId: 'home',
        awayTeamId: 'away',
        homeTeam: { id: 'home' },
        awayTeam: { id: 'away' },
      } as never);
    vi.mocked(prisma.pollLog.findUnique)
      .mockResolvedValueOnce({ polledAt: new Date('2026-06-01T00:00:00Z') } as never)
      .mockResolvedValueOnce({ polledAt: new Date('2026-06-01T00:00:01Z') } as never);
    vi.mocked(prisma.playerMatchStats.findMany)
      .mockResolvedValueOnce([{
        playerId: 'player-1',
        intercepts: 2,
        deflections: 0,
        rebounds: 0,
        turnovers: 0,
      }] as never)
      .mockResolvedValueOnce([{
        playerId: 'player-1',
        intercepts: 1,
        deflections: 0,
        rebounds: 0,
        turnovers: 0,
      }] as never);
    vi.mocked(processing.validateMatchData)
      .mockReturnValueOnce({
        valid: true,
        validatedData: {
          cdMatchId: 101,
          homeScore: 8,
          awayScore: 7,
          status: 'LIVE',
          currentQuarter: 2,
          currentTime: '300',
          quarterScores: [],
        },
      } as never)
      .mockReturnValueOnce({
        valid: true,
        validatedData: {
          cdMatchId: 101,
          homeScore: 9,
          awayScore: 8,
          status: 'LIVE',
          currentQuarter: 2,
          currentTime: '350',
          quarterScores: [],
        },
      } as never);
    vi.mocked(processing.reconcileCompletedMatches).mockResolvedValue([]);
    vi.mocked(processing.detectStaleCompletedMatches).mockResolvedValue([]);
    vi.mocked(processing.finalizeCompletedMatches).mockResolvedValue({ matches: [], failedMatchIds: [] });
    vi.mocked(processing.reconcileStaleCompletedScores).mockResolvedValue([]);

    await pollChampionData();
    await pollChampionData();

    expect(processing.applyChanges).toHaveBeenCalledTimes(2);
    expect(processing.applyChanges).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        newHomeScore: 8,
        newAwayScore: 7,
        currentTime: '300',
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(processing.applyChanges).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        newHomeScore: 9,
        newAwayScore: 8,
        currentTime: '350',
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(broadcasting.broadcastMatchChanges).toHaveBeenCalledTimes(2);
    expect(prisma.match.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.pollLog.update).toHaveBeenCalledWith({
      where: { id: 'correction-observation' },
      data: { status: 'processed', processingMs: expect.any(Number) },
    });
    expect(prisma.pollLog.update).toHaveBeenCalledWith({
      where: { id: 'continuation-observation' },
      data: { status: 'processed', processingMs: expect.any(Number) },
    });
    expect(processing.finalizeCompletedMatches).toHaveBeenLastCalledWith(
      [{ matchId: 101 }],
      12949,
      [],
      [],
      new Map([[101, new Date('2026-06-01T00:00:01Z')]]),
    );
  });

  it('lets a newer live observation reopen a heuristic unofficial completion', async () => {
    const { prisma } = await import('@/lib/db');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const processing = await import('@/lib/processing');
    const { pollChampionData } = await import('@/lib/worker');

    vi.mocked(ingestFromChampionData).mockResolvedValue({
      fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
      fixture: [{ matchId: 101 } as never],
      matchDetails: new Map([[101, { playerStats: null } as never]]),
      pollLogIds: [],
      matchPollLogIds: new Map([[101, 'match-101-log']]),
      detailFetchErrors: 0,
    });
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      id: 'db-match',
      competitionId: 'comp-1',
      resultQuality: 'UNOFFICIAL_FINAL',
      sourceRetrievedAt: new Date('2026-06-01T00:00:00Z'),
      sourceUpdatedAt: new Date('2026-05-31T23:59:59Z'),
      status: 'COMPLETED',
      homeScore: 10,
      awayScore: 9,
      currentQuarter: 4,
      currentTime: '899',
      round: 1,
      homeTeamId: 'home',
      awayTeamId: 'away',
      homeTeam: { id: 'home' },
      awayTeam: { id: 'away' },
    } as never);
    vi.mocked(processing.validateMatchData).mockReturnValue({
      valid: true,
      validatedData: {
        cdMatchId: 101, homeScore: 10, awayScore: 9, status: 'LIVE',
        currentQuarter: 4, currentTime: '850', quarterScores: [],
      },
    } as never);

    await pollChampionData();

    expect(processing.applyChanges).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: 'LIVE', statusChanged: true }),
      expect.objectContaining({ status: 'LIVE' }),
      expect.anything(),
    );
    expect(prisma.pollLog.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'match-101-log' },
      data: expect.objectContaining({ status: 'processed' }),
    }));
  });

  it('defers every provider completion to canonical finalization', async () => {
    const { prisma } = await import('@/lib/db');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const processing = await import('@/lib/processing');
    const { pollChampionData } = await import('@/lib/worker');

    vi.mocked(ingestFromChampionData).mockResolvedValue({
      fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
      fixture: [{ matchId: 101, matchStatus: 'complete' } as never],
      matchDetails: new Map([[101, { playerStats: { home: [], away: [] } } as never]]),
      pollLogIds: [],
      matchPollLogIds: new Map([[101, 'match-101-log']]),
      detailFetchErrors: 0,
    });
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      id: 'db-match', competitionId: 'comp-1', resultQuality: 'PROVISIONAL',
      sourceRetrievedAt: new Date('2026-06-01T00:00:00Z'),
      sourceUpdatedAt: new Date('2026-05-31T23:59:59Z'), status: 'LIVE',
      homeScore: 59, awayScore: 59, currentQuarter: 4, currentTime: '899',
      round: 1, homeTeamId: 'home', awayTeamId: 'away',
      homeTeam: { id: 'home' }, awayTeam: { id: 'away' },
    } as never);
    vi.mocked(processing.validateMatchData).mockReturnValue({
      valid: true,
      validatedData: {
        cdMatchId: 101, homeScore: 59, awayScore: 59, status: 'COMPLETED',
        currentQuarter: 4, currentTime: '900', quarterScores: [],
      },
    } as never);

    await pollChampionData();

    expect(processing.applyChanges).not.toHaveBeenCalled();
    expect(prisma.match.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourceUpdatedAt: expect.any(Date) }),
    }));
    expect(prisma.pollLog.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'match-101-log' },
      data: expect.objectContaining({ status: 'processed' }),
    }));
    expect(processing.reconcileCompletedMatches).toHaveBeenCalledWith(
      [{ matchId: 101, matchStatus: 'complete' }],
      new Map([[101, new Date('2026-06-01T00:00:00Z')]]),
    );
  });

  it('independently schedules a bounded retry from durable correction intent', async () => {
    const { prisma } = await import('@/lib/db');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const processing = await import('@/lib/processing');
    const broadcasting = await import('@/lib/broadcasting');
    const { pollChampionData } = await import('@/lib/worker');
    const persistedRevision = new Date('2026-06-01T00:00:02Z');

    vi.mocked(ingestFromChampionData).mockResolvedValue({
      fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
      fixture: [{ matchId: 101, matchStatus: 'complete' } as never],
      matchDetails: new Map(),
      pollLogIds: [],
      matchPollLogIds: new Map(),
      detailFetchErrors: 0,
    });
    vi.mocked(prisma.pollLog.findMany).mockResolvedValue([
      { cdMatchId: 101 },
    ] as never);
    vi.mocked(prisma.match.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'corrected-1' }] as never);
    vi.mocked(processing.finalizeCompletedMatches).mockResolvedValue({
      matches: [{
        matchId: 'corrected-1',
        homeScore: 58,
        awayScore: 57,
        finalQuarter: 4,
        sourceUpdatedAt: persistedRevision,
        standingsChanged: true,
      }],
      failedMatchIds: [],
    });

    await pollChampionData();

    expect(prisma.pollLog.findMany).toHaveBeenCalledWith({
      where: {
        endpoint: 'final-detail-correction',
        status: { in: ['pending', 'fetch_error', 'revision_mismatch'] },
        cdMatchId: { not: null },
      },
      select: { cdMatchId: true },
      orderBy: { polledAt: 'asc' },
      distinct: ['cdMatchId'],
      take: 100,
    });
    expect(processing.finalizeCompletedMatches).toHaveBeenCalledWith(
      [{ matchId: 101, matchStatus: 'complete' }],
      12949,
      ['corrected-1'],
      ['corrected-1'],
      new Map([[101, new Date('2026-06-01T00:00:00Z')]]),
    );
    expect(broadcasting.broadcastCompletion).toHaveBeenCalledOnce();
    expect(broadcasting.broadcastCompletion).toHaveBeenCalledWith(
      'corrected-1',
      58,
      57,
      4,
      persistedRevision,
    );
  });

  it('discards a slow fixture response older than the committed match revision', async () => {
    const { prisma } = await import('@/lib/db');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const processing = await import('@/lib/processing');
    const { recordPoll } = await import('@/lib/worker-health');
    const { pollChampionData } = await import('@/lib/worker');

    vi.mocked(ingestFromChampionData).mockResolvedValue({
      fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
      fixture: [{ matchId: 101, matchStatus: 'complete' } as never],
      matchDetails: new Map(),
      pollLogIds: [],
      matchPollLogIds: new Map(),
      detailFetchErrors: 1,
    });
    vi.mocked(prisma.match.findMany).mockResolvedValueOnce([{
      championDataMatchId: 101,
      sourceUpdatedAt: new Date('2026-06-01T00:00:01Z'),
    }] as never);

    await pollChampionData();

    expect(processing.syncFixtureMatches).toHaveBeenCalledWith(
      [],
      12949,
      12949,
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(processing.reconcileCompletedMatches).not.toHaveBeenCalled();
    expect(recordPoll).toHaveBeenCalledWith('empty', 0);
  });

  it('does not advance aggregate counters or emit when canonical event persistence fails', async () => {
    const { prisma } = await import('@/lib/db');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const processing = await import('@/lib/processing');
    const broadcasting = await import('@/lib/broadcasting');
    const { pollChampionData } = await import('@/lib/worker');

    vi.mocked(ingestFromChampionData).mockResolvedValue({
      fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
      fixture: [{ matchId: 101 } as never],
      matchDetails: new Map([[101, {
        playerStats: { home: [{ playerId: 10, intercepts: 1 }], away: [] },
      } as never]]),
      pollLogIds: [],
      matchPollLogIds: new Map([[101, 'match-101-log']]),
      detailFetchErrors: 0,
    });
    vi.mocked(prisma.team.findMany).mockResolvedValue([]);
    vi.mocked(prisma.player.findMany).mockResolvedValue([]);
    vi.mocked(prisma.playerMatchStats.findMany).mockResolvedValue([]);
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      id: 'db-match', sourceRetrievedAt: new Date('2026-06-01T00:00:00Z'),
      sourceUpdatedAt: null, round: 1, homeTeamId: 'home', awayTeamId: 'away',
      homeTeam: { id: 'home' }, awayTeam: { id: 'away' },
    } as never);
    vi.mocked(processing.validateMatchData).mockReturnValue({
      valid: true,
      validatedData: {
        cdMatchId: 101, homeScore: 1, awayScore: 0, status: 'LIVE',
        currentQuarter: 1, currentTime: '100', quarterScores: [],
      },
    } as never);
    vi.mocked(processing.detectChanges).mockResolvedValue({
      matchId: 'db-match', scoreChanged: true, statusChanged: false, timeChanged: false,
      newHomeScore: 1, newAwayScore: 0, newStatus: 'LIVE', currentQuarter: 1, currentTime: '100',
    });
    vi.mocked(broadcasting.persistStatEvents).mockRejectedValueOnce(new Error('event write failed'));

    await pollChampionData();

    expect(processing.applyChanges).not.toHaveBeenCalled();
    expect(broadcasting.broadcastMatchChanges).not.toHaveBeenCalled();
    expect(broadcasting.broadcastPersistedStatEvents).not.toHaveBeenCalled();
  });

  it('rolls back inferred events and emits nothing when aggregate persistence fails', async () => {
    const { prisma } = await import('@/lib/db');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const processing = await import('@/lib/processing');
    const broadcasting = await import('@/lib/broadcasting');
    const { pollChampionData } = await import('@/lib/worker');

    vi.mocked(ingestFromChampionData).mockResolvedValue({
      fixtureObservationAt: new Date('2026-06-01T00:00:00Z'),
      fixture: [{ matchId: 101 } as never],
      matchDetails: new Map([[101, {
        playerStats: { home: [{ playerId: 10, intercepts: 1 }], away: [] },
      } as never]]),
      pollLogIds: [],
      matchPollLogIds: new Map([[101, 'match-101-log']]),
      detailFetchErrors: 0,
    });
    vi.mocked(prisma.team.findMany).mockResolvedValue([]);
    vi.mocked(prisma.player.findMany).mockResolvedValue([]);
    vi.mocked(prisma.playerMatchStats.findMany).mockResolvedValue([]);
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      id: 'db-match', sourceRetrievedAt: new Date('2026-06-01T00:00:00Z'),
      sourceUpdatedAt: null, round: 1, homeTeamId: 'home', awayTeamId: 'away',
      homeTeam: { id: 'home' }, awayTeam: { id: 'away' },
    } as never);
    vi.mocked(processing.validateMatchData).mockReturnValue({
      valid: true,
      validatedData: {
        cdMatchId: 101, homeScore: 1, awayScore: 0, status: 'LIVE',
        currentQuarter: 1, currentTime: '100', quarterScores: [],
      },
    } as never);
    vi.mocked(processing.detectChanges).mockResolvedValue({
      matchId: 'db-match', scoreChanged: true, statusChanged: false, timeChanged: false,
      newHomeScore: 1, newAwayScore: 0, newStatus: 'LIVE', currentQuarter: 1, currentTime: '100',
    });
    vi.mocked(broadcasting.persistStatEvents).mockResolvedValue([{
      eventId: 'rolled-back-event', matchId: 'db-match', type: 'intercept',
      playerId: 'player-1', playerName: 'Player One', teamId: 'home',
      teamName: 'Home', teamAbbreviation: 'HOM', isHomeTeam: true,
      quarter: 1, time: '100',
    }]);
    vi.mocked(processing.applyChanges).mockRejectedValueOnce(new Error('aggregate write failed'));

    await pollChampionData();

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(broadcasting.persistStatEvents).toHaveBeenCalledOnce();
    expect(broadcasting.broadcastMatchChanges).not.toHaveBeenCalled();
    expect(broadcasting.broadcastPersistedStatEvents).not.toHaveBeenCalled();
  });
});
