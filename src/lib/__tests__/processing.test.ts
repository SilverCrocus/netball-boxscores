import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyChanges,
  finalizeCompletedMatches,
  validateMatchData,
  reconcileStaleCompletedScores,
  syncFixtureMatches,
} from '@/lib/processing';
import { fetchMatchStats } from '@/lib/champion-data';
import { prisma } from '@/lib/db';
import type { CDFixtureMatch, CDMatchStatsResponse } from '@/types/champion-data';

vi.mock('@/lib/champion-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/champion-data')>();
  return { ...actual, fetchMatchStats: vi.fn() };
});

vi.mock('@/lib/db', () => ({
  prisma: {
    competition: { findUnique: vi.fn() },
    team: { findMany: vi.fn() },
    match: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    matchQuarter: { upsert: vi.fn() },
    player: { findMany: vi.fn() },
    playerMatchStats: { findMany: vi.fn(), upsert: vi.fn() },
    scoreFlow: { findMany: vi.fn(), upsert: vi.fn() },
    teamMatchStats: { upsert: vi.fn() },
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

describe('applyChanges', () => {
  it('persists corrected detail data when the top-level match state is unchanged', async () => {
    vi.mocked(prisma.player.findMany).mockResolvedValue([
      { id: 'player-1', name: 'Player One', championDataPlayerId: 10, teamId: 'team-1' },
    ] as any);
    vi.mocked(prisma.playerMatchStats.findMany).mockResolvedValue([
      { playerId: 'player-1', goals: 5 },
    ] as any);
    vi.mocked(prisma.scoreFlow.findMany).mockResolvedValue([
      { period: 1, periodSeconds: 100, scoringTeamId: 'team-1' },
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

  it('dual-writes result quality when Champion Data changes match status', async () => {
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
        resultQuality: 'OFFICIAL_FINAL',
      }),
    });
  });
});

describe('syncFixtureMatches', () => {
  it('stores finals in the season competition with their source and stage', async () => {
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
    } as CDFixtureMatch], 12949, 12950);

    expect(synced).toBe(1);
    expect(prisma.match.upsert).toHaveBeenCalledWith({
      where: { championDataMatchId: 129500301 },
      update: expect.objectContaining({
        competitionId: 'season-2026',
        sourceCompetitionId: 12950,
        finalCode: 'GRAND',
        stageId: 'finals-stage',
        roundLabel: 'Round 3',
        sourceRetrievedAt: expect.any(Date),
      }),
      create: expect.objectContaining({
        championDataMatchId: 129500301,
        sourceCompetitionId: 12950,
        finalCode: 'GRAND',
        status: 'COMPLETED',
        stageId: 'finals-stage',
        resultQuality: 'OFFICIAL_FINAL',
      }),
    });
  });
});

describe('finalizeCompletedMatches', () => {
  it('preserves an unofficial stale completion while the source fixture is still playing', async () => {
    mockMatch.findMany.mockResolvedValue([{
      id: 'match-1',
      championDataMatchId: 100,
      sourceCompetitionId: 12949,
      homeScore: 60,
      awayScore: 40,
      resultQuality: 'UNOFFICIAL_FINAL',
    }]);

    const result = await finalizeCompletedMatches([{
      matchId: 100,
      matchStatus: 'playing',
      homeSquadScore: 61,
      awaySquadScore: 40,
      period: 4,
    } as CDFixtureMatch], 12949, ['match-1']);

    expect(mockMatch.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: { homeScore: 61, awayScore: 40 },
    });
    expect(mockMatch.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ resultQuality: 'OFFICIAL_FINAL' }),
      }),
    );
    expect(result).toEqual([{
      matchId: 'match-1',
      homeScore: 61,
      awayScore: 40,
      finalQuarter: 4,
    }]);
  });

  it('preserves CORRECTED when an official fixture is finalized', async () => {
    mockMatch.findMany.mockResolvedValue([{
      id: 'match-1',
      championDataMatchId: 100,
      sourceCompetitionId: 12949,
      homeScore: 61,
      awayScore: 40,
      resultQuality: 'CORRECTED',
    }]);
    vi.mocked(fetchMatchStats).mockResolvedValue({
      periodScores: [],
      playerStats: { home: [], away: [] },
      scoreFlow: [],
    } as unknown as CDMatchStatsResponse);

    await finalizeCompletedMatches([{
      matchId: 100,
      matchStatus: 'complete',
      homeSquadScore: 61,
      awaySquadScore: 40,
      period: 4,
    } as CDFixtureMatch], 12949, ['match-1']);

    expect(mockMatch.update).not.toHaveBeenCalled();
    expect(fetchMatchStats).toHaveBeenCalledWith(12949, 100);
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
      {
        id: 'm1',
        championDataMatchId: 100,
        homeScore: 64,
        awayScore: 64,
        resultQuality: 'UNOFFICIAL_FINAL',
      },
    ]);
    mockMatch.update.mockResolvedValue({});

    const result = await reconcileStaleCompletedScores([fixtureEntry(100, 66, 64)]);

    expect(mockMatch.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: {
        homeScore: 66,
        awayScore: 64,
        resultQuality: 'OFFICIAL_FINAL',
      },
    });
    expect(result).toEqual([
      { matchId: 'm1', homeScore: 66, awayScore: 64 },
    ]);
  });

  it('does not update matches whose score already matches the fixture', async () => {
    mockMatch.findMany.mockResolvedValue([
      {
        id: 'm1',
        championDataMatchId: 100,
        homeScore: 70,
        awayScore: 48,
        resultQuality: 'OFFICIAL_FINAL',
      },
    ]);

    const result = await reconcileStaleCompletedScores([fixtureEntry(100, 70, 48)]);

    expect(mockMatch.update).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('promotes an inferred completion once the official fixture is complete', async () => {
    mockMatch.findMany.mockResolvedValue([{
      id: 'm1',
      championDataMatchId: 100,
      homeScore: 70,
      awayScore: 48,
      resultQuality: 'UNOFFICIAL_FINAL',
    }]);

    const result = await reconcileStaleCompletedScores([
      fixtureEntry(100, 70, 48),
    ]);

    expect(mockMatch.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { resultQuality: 'OFFICIAL_FINAL' },
    });
    expect(result).toEqual([]);
  });

  it('preserves CORRECTED while reconciling an official score correction', async () => {
    mockMatch.findMany.mockResolvedValue([{
      id: 'm1',
      championDataMatchId: 100,
      homeScore: 69,
      awayScore: 48,
      resultQuality: 'CORRECTED',
    }]);

    const result = await reconcileStaleCompletedScores([
      fixtureEntry(100, 70, 48),
    ]);

    expect(mockMatch.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { homeScore: 70, awayScore: 48 },
    });
    expect(result).toEqual([{
      matchId: 'm1',
      homeScore: 70,
      awayScore: 48,
    }]);
  });

  it('ignores fixture entries that are not yet complete', async () => {
    mockMatch.findMany.mockResolvedValue([
      {
        id: 'm1',
        championDataMatchId: 100,
        homeScore: 30,
        awayScore: 28,
        resultQuality: 'UNOFFICIAL_FINAL',
      },
    ]);

    const result = await reconcileStaleCompletedScores([
      fixtureEntry(100, 40, 35, 'playing'),
    ]);

    expect(mockMatch.update).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('skips matches with no matching fixture entry', async () => {
    mockMatch.findMany.mockResolvedValue([
      {
        id: 'm1',
        championDataMatchId: 999,
        homeScore: 50,
        awayScore: 40,
        resultQuality: 'UNOFFICIAL_FINAL',
      },
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
