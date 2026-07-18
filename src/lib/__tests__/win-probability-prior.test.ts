import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  resolveAccess: vi.fn(),
  resolveAccessBatch: vi.fn(),
  canExposeScore: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { match: { findMany: mocks.findMany } },
  excludeSimData: { isSimulation: false },
}));

vi.mock('@/lib/competitions', () => ({
  getPublicCompetitions: vi.fn().mockResolvedValue([{ id: 'public-edition' }]),
}));

vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccessBatch: mocks.resolveAccessBatch,
  canExposePublicMatchScore: mocks.canExposeScore,
}));

import { computeTeamStrengthPrior } from '@/lib/win-probability';
import { getPublicCompetitions } from '@/lib/competitions';

describe('computeTeamStrengthPrior public history policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.resolveAccess.mockImplementation(async (matchId: string) => ({
      id: matchId,
      status: 'COMPLETED',
      resultQuality: 'OFFICIAL_FINAL',
    }));
    mocks.resolveAccessBatch.mockImplementation(async (matchIds: string[]) => {
      const entries = await Promise.all(matchIds.map(async (matchId) => [
        matchId,
        await mocks.resolveAccess(matchId),
      ] as const));
      return new Map(entries);
    });
    mocks.canExposeScore.mockReturnValue(true);
  });

  it('uses only final-quality results from published or legacy stages', async () => {
    await computeTeamStrengthPrior('home', 'away', 'current');

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'COMPLETED',
        competitionId: { in: ['public-edition'] },
        resultQuality: { in: ['UNOFFICIAL_FINAL', 'OFFICIAL_FINAL', 'CORRECTED'] },
        AND: [
          {
            OR: [
              { homeTeamId: { in: ['home', 'away'] } },
              { awayTeamId: { in: ['home', 'away'] } },
            ],
          },
          {
            OR: [
              { stageId: null },
              { stage: { is: { isPublished: true } } },
            ],
          },
        ],
      }),
      orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }],
      take: 200,
    }));
  });

  it('does not read historical scores when no edition is publicly ready', async () => {
    vi.mocked(getPublicCompetitions).mockResolvedValueOnce([]);

    await expect(computeTeamStrengthPrior('home', 'away', 'current')).resolves.toBeNull();

    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('excludes a final score when shared public capability policy denies it', async () => {
    mocks.findMany.mockResolvedValue([
      ...['home-1', 'home-2', 'home-3'].map((id) => ({
        id,
        homeTeamId: 'home',
        awayTeamId: 'other-home',
        homeScore: 60,
        awayScore: 50,
      })),
      {
        id: 'hidden-score',
        homeTeamId: 'home',
        awayTeamId: 'other-home',
        homeScore: 600,
        awayScore: 0,
      },
      ...['away-1', 'away-2', 'away-3'].map((id) => ({
        id,
        homeTeamId: 'away',
        awayTeamId: 'other-away',
        homeScore: 55,
        awayScore: 45,
      })),
    ]);
    mocks.canExposeScore.mockImplementation((access: { id: string }) => (
      access.id !== 'hidden-score'
    ));

    await expect(computeTeamStrengthPrior('home', 'away', 'current')).resolves.toEqual({
      expectedMargin: 0,
      homeAvgGoals: 52.5,
      awayAvgGoals: 52.5,
    });

    expect(mocks.resolveAccess).toHaveBeenCalledTimes(7);
    expect(mocks.resolveAccessBatch).toHaveBeenCalledOnce();
    expect(mocks.canExposeScore).toHaveBeenCalledTimes(7);
  });

  it('propagates capability lookup infrastructure failures', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'match-1' }]);
    mocks.resolveAccessBatch.mockRejectedValue(new Error('database unavailable'));

    await expect(computeTeamStrengthPrior('home', 'away', 'current'))
      .rejects.toThrow('database unavailable');
  });
});
