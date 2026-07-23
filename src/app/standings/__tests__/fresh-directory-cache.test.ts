import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cacheMock, competitionFindManyMock, standingFindManyMock } = vi.hoisted(() => ({
  cacheMock: vi.fn((loader: (...args: unknown[]) => unknown) => {
    let hasValue = false;
    let value: unknown;
    return (...args: unknown[]) => {
      if (!hasValue) {
        value = loader(...args);
        hasValue = true;
      }
      return value;
    };
  }),
  competitionFindManyMock: vi.fn(),
  standingFindManyMock: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, cache: cacheMock };
});
vi.mock('@/lib/db', () => ({
  excludeSimData: {},
  prisma: {
    competition: { findMany: competitionFindManyMock },
    standing: { findMany: standingFindManyMock },
  },
}));

import StandingsPage, { generateMetadata } from '../page';

const props = { searchParams: Promise.resolve({ edition: 'glasgow-2026' }) };
const navigationCandidate = {
  id: 'glasgow-2026',
  season: 2026,
  name: 'Glasgow 2026',
  slug: 'glasgow-2026',
  label: null,
  sourceTimezone: 'Europe/London',
  publicationStatus: 'PUBLISHED',
  series: {
    id: 'commonwealth-games-netball',
    slug: 'commonwealth-games-netball',
    name: 'Commonwealth Games Netball',
    kind: 'TOURNAMENT',
  },
  _count: { entries: 12, matches: 38 },
  stages: [
    ['pool-stage', 'POOL', 1, 2, 30],
    ['classification', 'CLASSIFICATION', 2, 0, 4],
    ['semi-finals', 'SEMI_FINALS', 3, 0, 2],
    ['medal-matches', 'MEDAL_MATCHES', 4, 0, 2],
  ].map(([slug, type, sequence, groups, matches]) => ({
    slug,
    type,
    sequence,
    isPublished: true,
    _count: { groups, matches },
  })),
  matches: Array.from({ length: 38 }, () => ({ _count: { slots: 2 } })),
  importRuns: [{ id: 'clean-import' }],
};
const readinessCandidate = {
  id: 'glasgow-2026',
  slug: 'glasgow-2026',
  publicationStatus: 'PUBLISHED',
  series: { slug: 'commonwealth-games-netball' },
  _count: { entries: 12, matches: 38 },
  stages: [
    ['pool-stage', 'POOL', 1, 2, 30],
    ['classification', 'CLASSIFICATION', 2, 0, 4],
    ['semi-finals', 'SEMI_FINALS', 3, 0, 2],
    ['medal-matches', 'MEDAL_MATCHES', 4, 0, 2],
  ].map(([slug, type, sequence, groups, matches]) => ({
    slug,
    type,
    sequence,
    isPublished: true,
    _count: { groups, matches },
  })),
  matches: Array.from({ length: 38 }, () => ({ _count: { slots: 2 } })),
  importRuns: [{ id: 'clean-import' }],
};

describe('Standings fresh directory request memoization', () => {
  beforeEach(() => {
    competitionFindManyMock.mockReset().mockImplementation(({ where }: { where?: { id?: unknown } }) =>
      Promise.resolve(where?.id ? [readinessCandidate] : [navigationCandidate]));
    standingFindManyMock.mockReset().mockResolvedValue([]);
  });

  it('shares one fresh joined directory across metadata and page', async () => {
    const [metadata, page] = await Promise.all([
      generateMetadata(props),
      StandingsPage(props),
    ]);

    expect(metadata.title).toBe('2026 SSN Standings');
    expect(page).toBeTruthy();
    expect(competitionFindManyMock).toHaveBeenCalledOnce();
    expect(competitionFindManyMock.mock.calls[0]?.[0]).toMatchObject({
      relationLoadStrategy: 'join',
      select: expect.objectContaining({
        stages: expect.objectContaining({ take: 5 }),
        matches: expect.objectContaining({ take: 39 }),
      }),
    });
    expect(competitionFindManyMock.mock.calls.filter(([args]) => args.where?.id)).toHaveLength(0);
    expect(standingFindManyMock).toHaveBeenCalledOnce();
    expect(cacheMock).toHaveBeenCalled();
  });
});
