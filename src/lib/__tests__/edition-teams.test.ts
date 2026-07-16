import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    editionEntry: {
      findMany: mocks.findMany,
    },
  },
}));

import { getEditionTeams } from '@/lib/edition-teams';

describe('getEditionTeams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only active entries with edition roster counts', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'jamaica-entry',
        seed: 2,
        displayName: null,
        primaryGroup: { name: 'Pool A' },
        team: {
          id: 'jamaica',
          name: 'Jamaica',
          slug: 'jamaica',
          abbreviation: 'JAM',
          logoUrl: null,
        },
        _count: { roster: 12 },
      },
      {
        id: 'australia-entry',
        seed: 1,
        displayName: 'Australia Diamonds',
        primaryGroup: { name: 'Pool A' },
        team: {
          id: 'australia',
          name: 'Australia',
          slug: 'australia',
          abbreviation: 'AUS',
          logoUrl: null,
        },
        _count: { roster: 12 },
      },
    ]);

    const teams = await getEditionTeams('glasgow-2026');

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        competitionId: 'glasgow-2026',
        status: 'ACTIVE',
      },
    }));
    expect(teams.map((entry) => entry.displayName)).toEqual([
      'Australia Diamonds',
      'Jamaica',
    ]);
    expect(teams[0]).toMatchObject({
      poolName: 'Pool A',
      rosterCount: 12,
      team: { slug: 'australia' },
    });
  });
});
