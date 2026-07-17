import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { match: { findMany: mocks.findMany } },
  excludeSimData: { isSimulation: false },
}));

import { computeTeamStrengthPrior } from '@/lib/win-probability';

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
});
