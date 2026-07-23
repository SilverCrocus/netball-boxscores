import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const stored = new Map<string, string>();
  return {
    findFirst: vi.fn(),
    unstableCache: vi.fn((loader: (...args: unknown[]) => Promise<unknown>, keyParts: string[], options: unknown) => {
      void keyParts;
      void options;
      return async (...args: unknown[]) => {
        const key = JSON.stringify(args);
        const cached = stored.get(key);
        if (cached !== undefined) return JSON.parse(cached) as unknown;
        const result = await loader(...args);
        stored.set(key, JSON.stringify(result));
        return result;
      };
    }),
    reset: () => stored.clear(),
  };
});

vi.mock('next/cache', () => ({ unstable_cache: mocks.unstableCache }));
vi.mock('@/lib/db', () => ({
  prisma: {
    stage: { findFirst: mocks.findFirst },
  },
}));

describe('tournament standings Next cache wrapper wiring (JSON cache emulation)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    mocks.findFirst.mockReset();
    mocks.reset();
  });

  it('emulates one loader read on a miss and no read after JSON cache rehydration', async () => {
    // This test proves the wrapper key/options and JSON-safe result boundary;
    // production Next SWR behavior is a deployment/remeasurement gate.
    const { getTournamentPoolStandings } = await import('../service');
    mocks.findFirst.mockResolvedValue({
      id: 'pool-stage',
      name: 'Pool Stage',
      groups: [{
        id: 'pool-a',
        slug: 'pool-a',
        name: 'Pool A',
        sequence: 1,
        primaryEntries: [{
          id: 'entry-aus',
          seed: 1,
          displayName: null,
          team: {
            id: 'team-aus',
            name: 'Australia',
            slug: 'australia',
            abbreviation: 'AUS',
            logoUrl: null,
          },
        }],
        standings: [],
      }],
    });

    const cold = await getTournamentPoolStandings('glasgow-2026');
    const warm = await getTournamentPoolStandings('glasgow-2026');

    expect(cold).toEqual(warm);
    expect(cold?.pools[0]?.rows[0]?.standing).toBeNull();
    expect(mocks.findFirst).toHaveBeenCalledOnce();
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      relationLoadStrategy: 'join',
    }));
    expect(mocks.unstableCache).toHaveBeenCalledWith(
      expect.any(Function),
      ['tournament-standings-v1'],
      { revalidate: 60, tags: ['standings'] },
    );
  });
});
