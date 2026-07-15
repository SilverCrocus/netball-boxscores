import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindUnique, mockFindMany, mockUpsert } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockFindMany: vi.fn(),
  mockUpsert: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    competition: { findUnique: mockFindUnique },
    match: { findMany: mockFindMany },
    standing: { upsert: mockUpsert },
  },
  excludeSimData: { isSimulation: false },
}));

import { recalculateStandings } from '@/lib/standings';

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsert.mockResolvedValue({});
});

const COMP = { id: 'comp-1', championDataId: 12949 };

describe('recalculateStandings', () => {
  it('skips when competition not found', async () => {
    mockFindUnique.mockResolvedValue(null);
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await recalculateStandings();

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('computes correct W/L/D and points for two teams', async () => {
    mockFindUnique.mockResolvedValue(COMP);
    mockFindMany.mockResolvedValue([
      // Team A wins
      { homeTeamId: 'team-a', awayTeamId: 'team-b', homeScore: 60, awayScore: 50 },
      // Team B wins
      { homeTeamId: 'team-b', awayTeamId: 'team-a', homeScore: 55, awayScore: 45 },
      // Team A wins again
      { homeTeamId: 'team-a', awayTeamId: 'team-b', homeScore: 70, awayScore: 62 },
    ]);

    await recalculateStandings();

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ finalCode: null }),
    }));

    // Team A: 2W 1L = 8pts, Team B: 1W 2L = 4pts
    // Team A should be rank 1, Team B rank 2
    expect(mockUpsert).toHaveBeenCalledTimes(2);

    const calls = mockUpsert.mock.calls.map((c) => c[0]);
    const teamACall = calls.find((c) => c.where.competitionId_teamId.teamId === 'team-a');
    const teamBCall = calls.find((c) => c.where.competitionId_teamId.teamId === 'team-b');

    expect(teamACall.update).toMatchObject({
      rank: 1,
      played: 3,
      wins: 2,
      losses: 1,
      draws: 0,
      points: 8,
      goalsFor: 175, // 60+45+70
      goalsAgainst: 167, // 50+55+62
    });

    expect(teamBCall.update).toMatchObject({
      rank: 2,
      played: 3,
      wins: 1,
      losses: 2,
      draws: 0,
      points: 4,
      goalsFor: 167,
      goalsAgainst: 175,
    });
  });

  it('awards no bonus points for large margin wins (SSN has no margin bonus)', async () => {
    mockFindUnique.mockResolvedValue(COMP);
    mockFindMany.mockResolvedValue([
      // Team A wins by a huge margin — still only 4 pts (no bonus in SSN)
      { homeTeamId: 'team-a', awayTeamId: 'team-b', homeScore: 80, awayScore: 50 },
      // Team B wins by a small margin — also 4 pts
      { homeTeamId: 'team-b', awayTeamId: 'team-a', homeScore: 65, awayScore: 64 },
    ]);

    await recalculateStandings();

    const calls = mockUpsert.mock.calls.map((c) => c[0]);
    const teamACall = calls.find((c) => c.where.competitionId_teamId.teamId === 'team-a');
    const teamBCall = calls.find((c) => c.where.competitionId_teamId.teamId === 'team-b');

    // Both teams: 1W = 4pts. Margin is irrelevant — SSN awards no bonus points.
    expect(teamACall.update.points).toBe(4);
    expect(teamBCall.update.points).toBe(4);
  });

  it('handles draws correctly', async () => {
    mockFindUnique.mockResolvedValue(COMP);
    mockFindMany.mockResolvedValue([
      { homeTeamId: 'team-a', awayTeamId: 'team-b', homeScore: 55, awayScore: 55 },
    ]);

    await recalculateStandings();

    const calls = mockUpsert.mock.calls.map((c) => c[0]);
    const teamACall = calls.find((c) => c.where.competitionId_teamId.teamId === 'team-a');
    const teamBCall = calls.find((c) => c.where.competitionId_teamId.teamId === 'team-b');

    expect(teamACall.update).toMatchObject({ draws: 1, points: 2 });
    expect(teamBCall.update).toMatchObject({ draws: 1, points: 2 });
  });

  it('computes goal percentage correctly', async () => {
    mockFindUnique.mockResolvedValue(COMP);
    mockFindMany.mockResolvedValue([
      { homeTeamId: 'team-a', awayTeamId: 'team-b', homeScore: 70, awayScore: 50 },
    ]);

    await recalculateStandings();

    const calls = mockUpsert.mock.calls.map((c) => c[0]);
    const teamACall = calls.find((c) => c.where.competitionId_teamId.teamId === 'team-a');
    const teamBCall = calls.find((c) => c.where.competitionId_teamId.teamId === 'team-b');

    // Team A: 70/50 * 100 = 140.0
    expect(teamACall.update.goalPercentage).toBe(140.0);
    // Team B: 50/70 * 100 = 71.4
    expect(teamBCall.update.goalPercentage).toBe(71.4);
  });

  it('ranks by points first, then goal percentage', async () => {
    mockFindUnique.mockResolvedValue(COMP);
    mockFindMany.mockResolvedValue([
      // Team A and C both win 1 game (4pts each) but A has better goal%
      { homeTeamId: 'team-a', awayTeamId: 'team-b', homeScore: 80, awayScore: 50 },
      { homeTeamId: 'team-c', awayTeamId: 'team-b', homeScore: 55, awayScore: 50 },
    ]);

    await recalculateStandings();

    const calls = mockUpsert.mock.calls.map((c) => c[0]);
    const teamACall = calls.find((c) => c.where.competitionId_teamId.teamId === 'team-a');
    const teamCCall = calls.find((c) => c.where.competitionId_teamId.teamId === 'team-c');
    const teamBCall = calls.find((c) => c.where.competitionId_teamId.teamId === 'team-b');

    // A and C: 4pts each. A has 80/50=160%, C has 55/50=110%. A ranks higher.
    expect(teamACall.update.rank).toBe(1);
    expect(teamCCall.update.rank).toBe(2);
    // B: 0pts, rank 3
    expect(teamBCall.update.rank).toBe(3);
  });

  it('passes excludeSimData in match query', async () => {
    mockFindUnique.mockResolvedValue(COMP);
    mockFindMany.mockResolvedValue([]);

    await recalculateStandings();

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'COMPLETED',
          isSimulation: false,
        }),
      })
    );
  });
});
