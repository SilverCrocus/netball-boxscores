import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cacheHits: 0,
  findMatches: vi.fn(),
  resolvePublicMatch: vi.fn(),
  resolvePublicMatchBatch: vi.fn(),
}));

vi.mock('next/cache', () => ({
  unstable_cache: (loader: (...args: unknown[]) => Promise<unknown>) => {
    let cachedJson: string | undefined;

    return async (...args: unknown[]) => {
      if (cachedJson !== undefined) {
        mocks.cacheHits += 1;
        return JSON.parse(cachedJson) as unknown;
      }

      const value = await loader(...args);
      cachedJson = JSON.stringify(value);
      return value;
    };
  },
}));

vi.mock('@/lib/db', () => ({
  excludeSimData: { isSimulation: false },
  prisma: { match: { findMany: mocks.findMatches } },
}));

vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccessBatch: mocks.resolvePublicMatchBatch,
  canExposePublicMatchScore: (access: { scoreAvailable: boolean }) => access.scoreAvailable,
}));

type HomeFeedModule = typeof import('@/lib/home-feed');

let homeFeed: HomeFeedModule;

function match(
  index: number,
  homeScore = 62,
  sourceUpdatedAt = new Date('2026-07-25T09:00:01.000Z'),
) {
  return {
    id: `match-${index}`,
    competitionId: 'competition-2026',
    status: 'COMPLETED',
    resultQuality: 'OFFICIAL_FINAL',
    scheduledAt: new Date(Date.UTC(2026, 5, index)),
    homeScore,
    awayScore: 58,
    sourceUpdatedAt,
    venue: 'Arena',
    round: 10,
    roundLabel: null,
    finalCode: null,
    stage: null,
    currentQuarter: null,
    currentTime: null,
    homeTeamId: 'home',
    awayTeamId: 'away',
    homeTeam: { name: 'Vipers', abbreviation: 'VIP', logoUrl: null },
    awayTeam: { name: 'Stars', abbreviation: 'STA', logoUrl: null },
    competition: {
      dataCoverage: [
        { capability: 'FINAL_SCORE', state: 'AVAILABLE' },
        { capability: 'SUPER_SHOTS', state: 'AVAILABLE' },
      ],
    },
    dataCoverage: [],
    teamStats: [],
  };
}

describe('production home result candidate cache', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    homeFeed = await import('@/lib/home-feed');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('revives cached ordering but always overlays the latest canonical score', async () => {
    const initialRevision = new Date('2026-07-25T09:00:01.000Z');
    const correctedRevision = new Date('2026-07-25T09:00:02.000Z');
    const matches = Array.from(
      { length: 9 },
      (_, index) => match(9 - index, 62, initialRevision),
    );
    const correctedMatches = Array.from(
      { length: 9 },
      (_, index) => match(9 - index, 60, correctedRevision),
    );
    mocks.findMatches
      .mockResolvedValueOnce(matches)
      .mockResolvedValueOnce(matches)
      .mockResolvedValueOnce(correctedMatches);
    let accessPass = 0;
    mocks.resolvePublicMatchBatch.mockImplementation(async (ids: string[]) => {
      accessPass += 1;
      const sourceUpdatedAt = accessPass === 1 ? initialRevision : correctedRevision;
      const access = ids.map((id) => [id, {
        status: 'COMPLETED',
        resultQuality: 'OFFICIAL_FINAL',
        sourceUpdatedAt,
        scoreAvailable: true,
        features: { superShots: { available: true } },
      }] as const);
      return new Map(access);
    });

    const initialPage = await homeFeed.loadCompletedMatchesPage('competition-2026');
    const cachedPage = await homeFeed.loadCompletedMatchesPage('competition-2026');

    expect(mocks.cacheHits).toBe(1);
    expect(mocks.findMatches).toHaveBeenCalledTimes(3);
    expect(initialPage.groups[0].matches[0].homeScore).toBe(62);
    expect(cachedPage.groups[0].matches[0].homeScore).toBe(60);
    expect(cachedPage.groups.flatMap((group) => group.matches)).toHaveLength(8);
    expect(homeFeed.decodeCompletedCursor(cachedPage.nextCursor!)).toEqual({
      id: 'match-2',
      scheduledAt: new Date(Date.UTC(2026, 5, 2)).toISOString(),
    });
  });
});
