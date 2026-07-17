import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { match: { findMany: mocks.findMany } },
  excludeSimData: { isSimulation: false },
}));

vi.mock('@/lib/competitions', () => ({
  getPublicCompetitions: vi.fn().mockResolvedValue([{ id: 'public-edition' }]),
}));

import { computeTeamStrengthPrior } from '@/lib/win-probability';
import { getPublicCompetitions } from '@/lib/competitions';

describe('computeTeamStrengthPrior public history policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
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
    }));
  });

  it('does not read historical scores when no edition is publicly ready', async () => {
    vi.mocked(getPublicCompetitions).mockResolvedValueOnce([]);

    await expect(computeTeamStrengthPrior('home', 'away', 'current')).resolves.toBeNull();

    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
