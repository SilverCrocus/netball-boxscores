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
  detectChanges: vi.fn(),
  applyChanges: vi.fn(),
  reconcileCompletedMatches: vi.fn(),
  reconcileStaleCompletedScores: vi.fn().mockResolvedValue([]),
  detectStaleCompletedMatches: vi.fn(),
  finalizeCompletedMatches: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/broadcasting', () => ({
  broadcastMatchChanges: vi.fn(),
  broadcastPlayerStats: vi.fn(),
  persistAndBroadcastStatEvents: vi.fn(),
  broadcastCompletion: vi.fn(),
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
});
