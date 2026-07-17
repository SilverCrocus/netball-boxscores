import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    team: { findMany: vi.fn() },
    player: { findMany: vi.fn() },
    playerMatchStats: { findMany: vi.fn() },
    match: { findUnique: vi.fn() },
    pollLog: { update: vi.fn() },
  },
  excludeSimData: {},
}));

vi.mock('@/lib/live-state', () => ({
  getLiveState: vi.fn(),
}));

vi.mock('@/lib/ingestion', () => ({
  ingestFromChampionData: vi.fn(),
}));

vi.mock('@/lib/processing', () => ({
  validateMatchData: vi.fn(),
  syncFixtureMatches: vi.fn().mockResolvedValue(0),
  detectChanges: vi.fn(),
  applyChanges: vi.fn(),
  reconcileCompletedMatches: vi.fn(),
  reconcileStaleCompletedScores: vi.fn().mockResolvedValue([]),
  detectStaleCompletedMatches: vi.fn(),
  finalizeCompletedMatches: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/broadcasting', () => ({
  broadcastMatchChanges: vi.fn().mockResolvedValue(undefined),
  broadcastPlayerStats: vi.fn().mockResolvedValue(undefined),
  persistStatEvents: vi.fn().mockResolvedValue([]),
  broadcastPersistedStatEvents: vi.fn().mockResolvedValue(undefined),
  broadcastCompletion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccess: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/standings', () => ({
  recalculateStandings: vi.fn(),
}));

vi.mock('@/lib/worker-health', () => ({
  recordPoll: vi.fn(),
  setCurrentInterval: vi.fn(),
}));

describe('Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Most worker unit tests exercise one source; a dedicated test below covers finals.
    vi.stubEnv('SSN_FINALS_COMPETITION_ID', '12949');
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
    expect(getPollingInterval(true, true, false)).toBe(10_000);
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

  it('persists unchanged-state corrections and updates each match PollLog', async () => {
    const { prisma } = await import('@/lib/db');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const processing = await import('@/lib/processing');
    const { pollChampionData } = await import('@/lib/worker');

    vi.mocked(ingestFromChampionData).mockResolvedValue({
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
    vi.mocked(processing.finalizeCompletedMatches).mockResolvedValue([]);
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
    vi.mocked(processing.finalizeCompletedMatches).mockResolvedValue([]);
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
        fixture: [{ matchId: 101 } as any],
        matchDetails: new Map(),
        pollLogIds: [],
        matchPollLogIds: new Map(),
        detailFetchErrors: 0,
      })
      .mockResolvedValueOnce({
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
    vi.mocked(processing.finalizeCompletedMatches).mockResolvedValue([]);
    vi.mocked(processing.reconcileStaleCompletedScores).mockResolvedValue([]);

    await pollChampionData();

    expect(ingestFromChampionData).toHaveBeenNthCalledWith(1, 12949);
    expect(ingestFromChampionData).toHaveBeenNthCalledWith(2, 12950);
    expect(processing.syncFixtureMatches).toHaveBeenNthCalledWith(
      1,
      [{ matchId: 101 }],
      12949,
      12949,
    );
    expect(processing.syncFixtureMatches).toHaveBeenNthCalledWith(
      2,
      [{ matchId: 201, finalCode: 'SEMI' }],
      12949,
      12950,
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
    vi.mocked(processing.finalizeCompletedMatches).mockResolvedValue([]);
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
      fixture: [{ matchId: 101 } as never],
      matchDetails: new Map([[101, {
        playerStats: {
          home: [{ playerId: 10, intercepts: 1 }],
          away: [],
        },
      } as never]]),
      pollLogIds: [],
      matchPollLogIds: new Map(),
      detailFetchErrors: 0,
    });
    vi.mocked(prisma.team.findMany).mockResolvedValue([]);
    vi.mocked(prisma.player.findMany).mockResolvedValue([]);
    vi.mocked(prisma.playerMatchStats.findMany).mockResolvedValue([]);
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      id: 'db-match',
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
    vi.mocked(processing.finalizeCompletedMatches).mockResolvedValue([]);
    vi.mocked(processing.reconcileStaleCompletedScores).mockResolvedValue([]);

    await pollChampionData();

    const persistOrder = vi.mocked(broadcasting.persistStatEvents).mock.invocationCallOrder[0];
    expect(persistOrder).toBeLessThan(vi.mocked(processing.applyChanges).mock.invocationCallOrder[0]);
    expect(persistOrder).toBeLessThan(vi.mocked(broadcasting.broadcastMatchChanges).mock.invocationCallOrder[0]);
    expect(persistOrder).toBeLessThan(vi.mocked(broadcasting.broadcastPersistedStatEvents).mock.invocationCallOrder[0]);
  });

  it('does not advance aggregate counters or emit when canonical event persistence fails', async () => {
    const { prisma } = await import('@/lib/db');
    const { ingestFromChampionData } = await import('@/lib/ingestion');
    const processing = await import('@/lib/processing');
    const broadcasting = await import('@/lib/broadcasting');
    const { pollChampionData } = await import('@/lib/worker');

    vi.mocked(ingestFromChampionData).mockResolvedValue({
      fixture: [{ matchId: 101 } as never],
      matchDetails: new Map([[101, {
        playerStats: { home: [{ playerId: 10, intercepts: 1 }], away: [] },
      } as never]]),
      pollLogIds: [],
      matchPollLogIds: new Map(),
      detailFetchErrors: 0,
    });
    vi.mocked(prisma.team.findMany).mockResolvedValue([]);
    vi.mocked(prisma.player.findMany).mockResolvedValue([]);
    vi.mocked(prisma.playerMatchStats.findMany).mockResolvedValue([]);
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      id: 'db-match', round: 1, homeTeamId: 'home', awayTeamId: 'away',
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
});
