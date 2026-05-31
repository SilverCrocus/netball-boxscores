import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateMatchData, reconcileStaleCompletedScores } from '@/lib/processing';
import { prisma } from '@/lib/db';
import type { CDFixtureMatch, CDMatchStatsResponse } from '@/types/champion-data';

vi.mock('@/lib/db', () => ({
  prisma: {
    match: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    matchQuarter: { upsert: vi.fn() },
    playerMatchStats: { findMany: vi.fn(), upsert: vi.fn() },
    scoreFlow: { findMany: vi.fn(), upsert: vi.fn() },
    pollLog: { update: vi.fn() },
    $transaction: vi.fn((fns: any[]) => Promise.all(fns)),
  },
  excludeSimData: {},
}));

const mockMatch = prisma.match as unknown as {
  findMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
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

  const baseDetail: CDMatchStatsResponse = {
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
  };

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
    };
    const result = validateMatchData(baseFixture, detailWithPlayers, dbTeams, dbPlayers);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining('9999'));
  });

  it('warns on non-monotonic score flow but still includes data', () => {
    const badScoreFlow: CDMatchStatsResponse = {
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

  it('updates COMPLETED matches whose stored score drifted from the fixture', async () => {
    mockMatch.findMany.mockResolvedValue([
      { id: 'm1', championDataMatchId: 100, homeScore: 64, awayScore: 64 },
    ]);
    mockMatch.update.mockResolvedValue({});

    const result = await reconcileStaleCompletedScores([fixtureEntry(100, 66, 64)]);

    expect(mockMatch.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { homeScore: 66, awayScore: 64 },
    });
    expect(result).toEqual([
      { matchId: 'm1', homeScore: 66, awayScore: 64 },
    ]);
  });

  it('does not update matches whose score already matches the fixture', async () => {
    mockMatch.findMany.mockResolvedValue([
      { id: 'm1', championDataMatchId: 100, homeScore: 70, awayScore: 48 },
    ]);

    const result = await reconcileStaleCompletedScores([fixtureEntry(100, 70, 48)]);

    expect(mockMatch.update).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('ignores fixture entries that are not yet complete', async () => {
    mockMatch.findMany.mockResolvedValue([
      { id: 'm1', championDataMatchId: 100, homeScore: 30, awayScore: 28 },
    ]);

    const result = await reconcileStaleCompletedScores([
      fixtureEntry(100, 40, 35, 'playing'),
    ]);

    expect(mockMatch.update).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('skips matches with no matching fixture entry', async () => {
    mockMatch.findMany.mockResolvedValue([
      { id: 'm1', championDataMatchId: 999, homeScore: 50, awayScore: 40 },
    ]);

    const result = await reconcileStaleCompletedScores([fixtureEntry(100, 66, 64)]);

    expect(mockMatch.update).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('returns empty when there are no completed matches', async () => {
    mockMatch.findMany.mockResolvedValue([]);

    const result = await reconcileStaleCompletedScores([fixtureEntry(100, 66, 64)]);

    expect(mockMatch.update).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
