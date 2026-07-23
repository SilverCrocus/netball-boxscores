import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connection: vi.fn().mockResolvedValue(undefined),
  findMany: vi.fn().mockResolvedValue([]),
}));

vi.mock('next/server', () => ({ connection: mocks.connection }));
vi.mock('next/cache', () => ({ unstable_cache: (loader: unknown) => loader }));
vi.mock('@/lib/db', () => ({
  prisma: { competition: { findMany: mocks.findMany } },
}));

import {
  liveFallbackCompetitionSelect,
  loadLiveFallbackCompetition,
  MAX_LIVE_FALLBACK_COMPETITION_CANDIDATES,
  competitionNavigationSelect,
  competitionOptionSelect,
  getCompetitions,
  getPublicCompetitionNavigationDirectory,
} from '@/lib/competitions';

describe('competition directory query', () => {
  beforeEach(() => {
    mocks.connection.mockClear();
    mocks.findMany.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the database on each request instead of retaining a CLI-stale process cache', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await getCompetitions();
    await getCompetitions();

    expect(mocks.connection).toHaveBeenCalledTimes(2);
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
  });

  it('counts only active edition entries for the public readiness gate', () => {
    expect(competitionOptionSelect._count.select.entries).toEqual({
      where: { status: 'ACTIVE' },
    });
  });

  it('uses a small selector projection for the global competition directory', async () => {
    findNavigationCandidate();

    await expect(getPublicCompetitionNavigationDirectory()).resolves.toMatchObject([
      { id: 'edition-1', slug: '2026', series: { slug: 'suncorp-super-netball' } },
    ]);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { publicationStatus: 'PUBLISHED' },
      select: competitionNavigationSelect,
    }));
    expect(competitionNavigationSelect).not.toHaveProperty('ruleset');
    expect(competitionNavigationSelect).not.toHaveProperty('dataCoverage');
  });

  it('keeps generic publication gates and Glasgow readiness semantics in the directory', async () => {
    mocks.findMany.mockResolvedValueOnce([
      navigationCandidate({ id: 'generic-unready', countEntries: 1, countMatches: 0 }),
      navigationCandidate({
        id: 'glasgow-shell',
        seriesSlug: 'commonwealth-games-netball',
        slug: 'glasgow-2026',
        countEntries: 12,
        countMatches: 38,
      }),
    ]).mockResolvedValueOnce([glasgowReadinessCandidate('glasgow-shell', false)]);

    await expect(getPublicCompetitionNavigationDirectory()).resolves.toEqual([]);
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
  });

  it('uses a bounded policy projection and skips a newer published but unready shell', async () => {
    mocks.findMany.mockResolvedValueOnce([
      liveFallbackCandidate({ id: 'glasgow-shell', ready: false }),
      liveFallbackCandidate({ id: 'glasgow-ready', ready: true }),
    ]);

    await expect(loadLiveFallbackCompetition()).resolves.toMatchObject({
      id: 'glasgow-ready',
    });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { publicationStatus: 'PUBLISHED' },
      select: liveFallbackCompetitionSelect,
      orderBy: [{ season: 'desc' }, { seasonStart: 'desc' }, { id: 'desc' }],
      take: MAX_LIVE_FALLBACK_COMPETITION_CANDIDATES,
    });
    expect(liveFallbackCompetitionSelect).not.toHaveProperty('ruleset');
    expect(liveFallbackCompetitionSelect).not.toHaveProperty('label');
    expect(liveFallbackCompetitionSelect).toHaveProperty('dataCoverage');
    expect(liveFallbackCompetitionSelect).toHaveProperty('stages');
  });

  it('returns no fallback competition when every bounded candidate fails strict readiness', async () => {
    mocks.findMany.mockResolvedValueOnce([
      liveFallbackCandidate({ id: 'glasgow-shell', ready: false }),
    ]);

    await expect(loadLiveFallbackCompetition()).resolves.toBeNull();
  });
});

function navigationCandidate(overrides: {
  id?: string;
  slug?: string;
  seriesSlug?: string;
  countEntries?: number;
  countMatches?: number;
} = {}) {
  return {
    id: overrides.id ?? 'edition-1',
    season: 2026,
    name: 'SSN 2026',
    slug: overrides.slug ?? '2026',
    label: null,
    sourceTimezone: 'Australia/Sydney',
    publicationStatus: 'PUBLISHED',
    series: {
      id: 'series-1',
      slug: overrides.seriesSlug ?? 'suncorp-super-netball',
      name: 'Suncorp Super Netball',
      kind: 'LEAGUE',
    },
    _count: {
      entries: overrides.countEntries ?? 8,
      matches: overrides.countMatches ?? 64,
    },
  };
}

function findNavigationCandidate() {
  mocks.findMany.mockResolvedValueOnce([navigationCandidate()]);
}

function glasgowReadinessCandidate(id: string, ready: boolean) {
  return {
    id,
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
      isPublished: ready,
      _count: { groups, matches },
    })),
    matches: Array.from({ length: 38 }, () => ({ _count: { slots: 2 } })),
    importRuns: ready ? [{ id: 'clean-import' }] : [],
  };
}

function liveFallbackCandidate({ id, ready }: { id: string; ready: boolean }) {
  return {
    id,
    slug: 'glasgow-2026',
    publicationStatus: 'PUBLISHED',
    series: { slug: 'commonwealth-games-netball' },
    dataCoverage: [
      { capability: 'FINAL_SCORE', state: 'AVAILABLE' },
      { capability: 'SUPER_SHOTS', state: 'AVAILABLE' },
    ],
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
      isPublished: ready,
      _count: { groups, matches },
    })),
    matches: Array.from({ length: 38 }, () => ({ _count: { slots: 2 } })),
    importRuns: ready ? [{ id: 'clean-import' }] : [],
  };
}
