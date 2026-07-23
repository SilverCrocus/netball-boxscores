import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StageType } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  connection: vi.fn().mockResolvedValue(undefined),
  findMany: vi.fn().mockResolvedValue([]),
  transaction: vi.fn(),
}));

vi.mock('next/server', () => ({ connection: mocks.connection }));
vi.mock('next/cache', () => ({ unstable_cache: (loader: unknown) => loader }));
vi.mock('@/lib/db', () => ({
  prisma: {
    competition: { findMany: mocks.findMany },
    $transaction: mocks.transaction,
  },
}));

import {
  GLASGOW_2026_EXPECTED_MATCH_COUNT,
  GLASGOW_2026_EXPECTED_MATCH_SLOT_COUNT,
  GLASGOW_2026_EXPECTED_STAGE_COUNT,
  GLASGOW_2026_EXPECTED_TEAM_COUNT,
  isEditionPubliclyReady,
  LIVE_FALLBACK_GLASGOW_MATCH_EVIDENCE_LIMIT,
  LIVE_FALLBACK_GLASGOW_STAGE_EVIDENCE_LIMIT,
  liveFallbackCompetitionSelect,
  loadLiveFallbackCompetition,
  MAX_LIVE_FALLBACK_COMPETITION_CANDIDATES,
  competitionNavigationSelect,
  competitionOptionSelect,
  getCompetitions,
  getPublicCompetitionNavigationDirectory,
  standingsDirectorySelect,
} from '@/lib/competitions';

describe('competition directory query', () => {
  beforeEach(() => {
    mocks.connection.mockClear();
    mocks.findMany.mockReset().mockResolvedValue([]);
    mocks.transaction.mockReset().mockImplementation(async (callback: (transaction: unknown) => unknown) => callback({
      competition: { findMany: mocks.findMany },
    }));
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
    expect(competitionOptionSelect.stages).not.toHaveProperty('take');
    expect(competitionOptionSelect.matches).not.toHaveProperty('take');
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

  it('uses one bounded joined projection for the fresh legacy standings directory', async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        ...navigationCandidate({
          id: 'glasgow-ready',
          seriesSlug: 'commonwealth-games-netball',
          slug: 'glasgow-2026',
          countEntries: 12,
          countMatches: 38,
        }),
        stages: glasgowReadinessCandidate('glasgow-ready', true).stages,
        matches: glasgowReadinessCandidate('glasgow-ready', true).matches,
        importRuns: [{ id: 'clean-import' }],
      },
    ]);

    await expect(getPublicCompetitionNavigationDirectory({ cache: false })).resolves.toMatchObject([
      { id: 'glasgow-ready' },
    ]);
    expect(mocks.findMany).toHaveBeenCalledOnce();
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { publicationStatus: 'PUBLISHED' },
      select: standingsDirectorySelect,
      relationLoadStrategy: 'join',
    }));
    expect(standingsDirectorySelect.stages.take)
      .toBe(GLASGOW_2026_EXPECTED_STAGE_COUNT + 1);
    expect(standingsDirectorySelect.matches.take)
      .toBe(GLASGOW_2026_EXPECTED_MATCH_COUNT + 1);
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
      relationLoadStrategy: 'join',
      orderBy: [{ season: 'desc' }, { seasonStart: 'desc' }, { id: 'desc' }],
      take: MAX_LIVE_FALLBACK_COMPETITION_CANDIDATES,
    });
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'RepeatableRead' }),
    );
    expect(liveFallbackCompetitionSelect).not.toHaveProperty('ruleset');
    expect(liveFallbackCompetitionSelect).not.toHaveProperty('label');
    expect(liveFallbackCompetitionSelect).toHaveProperty('dataCoverage');
    expect(liveFallbackCompetitionSelect._count.select).toMatchObject({
      entries: { where: { status: 'ACTIVE' } },
      matches: true,
      stages: true,
    });
    expect(liveFallbackCompetitionSelect.stages).toMatchObject({
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
      take: LIVE_FALLBACK_GLASGOW_STAGE_EVIDENCE_LIMIT,
    });
    expect(liveFallbackCompetitionSelect.matches).toMatchObject({
      orderBy: { id: 'asc' },
      take: LIVE_FALLBACK_GLASGOW_MATCH_EVIDENCE_LIMIT,
    });
    expect(liveFallbackCompetitionSelect).toHaveProperty('stages');
    expect(liveFallbackCompetitionSelect).toHaveProperty('matches');
  });

  it('keeps every exact Glasgow threshold and rejects each plus-one overflow', () => {
    const exact = strictGlasgowCandidate();
    expect(exact.matches.reduce((total, match) => total + match._count.slots, 0))
      .toBe(GLASGOW_2026_EXPECTED_MATCH_SLOT_COUNT);
    expect(isEditionPubliclyReady(exact)).toBe(true);
    expect(isEditionPubliclyReady(strictGlasgowCandidate({ entries: GLASGOW_2026_EXPECTED_TEAM_COUNT + 1 })))
      .toBe(false);
    expect(isEditionPubliclyReady(strictGlasgowCandidate({ matches: GLASGOW_2026_EXPECTED_MATCH_COUNT + 1 })))
      .toBe(false);
    expect(isEditionPubliclyReady(strictGlasgowCandidate({ extraSlot: true }))).toBe(false);
    expect(isEditionPubliclyReady(strictGlasgowCandidate({ stageCount: GLASGOW_2026_EXPECTED_STAGE_COUNT + 1 })))
      .toBe(false);
  });

  it('rejects unexpected Glasgow stages and preserves generic editions above Glasgow sizes', () => {
    expect(isEditionPubliclyReady(strictGlasgowCandidate({
      stages: [
        ...strictGlasgowStages(),
        {
          slug: 'unexpected-stage',
          type: 'OTHER',
          sequence: 5,
          isPublished: true,
          _count: { groups: 0, matches: 1 },
        },
      ],
      stageCount: GLASGOW_2026_EXPECTED_STAGE_COUNT + 1,
    }))).toBe(false);
    expect(isEditionPubliclyReady({
      id: 'generic-large',
      slug: '2026',
      publicationStatus: 'PUBLISHED',
      series: { slug: 'suncorp-super-netball' },
      _count: { entries: GLASGOW_2026_EXPECTED_TEAM_COUNT + 20, matches: GLASGOW_2026_EXPECTED_MATCH_COUNT + 20 },
      stages: [],
      matches: [],
      importRuns: [],
    })).toBe(true);
  });

  it('continues deterministic cursor pages when more than one page of newer shells is unready', async () => {
    mocks.findMany
      .mockResolvedValueOnce(Array.from({ length: MAX_LIVE_FALLBACK_COMPETITION_CANDIDATES }, (_, index) =>
        liveFallbackCandidate({ id: `glasgow-shell-${index}`, ready: false }),
      ))
      .mockResolvedValueOnce([
        liveFallbackCandidate({ id: 'glasgow-ready', ready: true }),
      ]);

    await expect(loadLiveFallbackCompetition()).resolves.toMatchObject({
      id: 'glasgow-ready',
    });
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.findMany).toHaveBeenNthCalledWith(2, {
      where: { publicationStatus: 'PUBLISHED' },
      select: liveFallbackCompetitionSelect,
      relationLoadStrategy: 'join',
      orderBy: [{ season: 'desc' }, { seasonStart: 'desc' }, { id: 'desc' }],
      take: MAX_LIVE_FALLBACK_COMPETITION_CANDIDATES,
      cursor: { id: 'glasgow-shell-31' },
      skip: 1,
    });
  });

  it('returns no fallback competition when every published candidate fails strict readiness', async () => {
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

function strictGlasgowStages() {
  const definitions: Array<[string, StageType, number, number, number]> = [
    ['pool-stage', 'POOL', 1, 2, 30],
    ['classification', 'CLASSIFICATION', 2, 0, 4],
    ['semi-finals', 'SEMI_FINALS', 3, 0, 2],
    ['medal-matches', 'MEDAL_MATCHES', 4, 0, 2],
  ];
  return definitions.map(([slug, type, sequence, groups, matches]) => ({
    slug,
    type,
    sequence,
    isPublished: true,
    _count: { groups, matches },
  }));
}

function strictGlasgowCandidate(overrides: {
  entries?: number;
  matches?: number;
  stageCount?: number;
  stages?: Array<{
    slug: string;
    type: StageType;
    sequence: number;
    isPublished: boolean;
    _count: { groups: number; matches: number };
  }>;
  extraSlot?: boolean;
} = {}) {
  const matches = overrides.matches ?? GLASGOW_2026_EXPECTED_MATCH_COUNT;
  const matchEvidence = Array.from({ length: matches }, (_, index) => ({
    _count: { slots: index === 0 && overrides.extraSlot ? 3 : 2 },
  }));
  return {
    id: 'glasgow-strict',
    slug: 'glasgow-2026',
    publicationStatus: 'PUBLISHED' as const,
    series: { slug: 'commonwealth-games-netball' },
    _count: {
      entries: overrides.entries ?? GLASGOW_2026_EXPECTED_TEAM_COUNT,
      matches,
      stages: overrides.stageCount ?? GLASGOW_2026_EXPECTED_STAGE_COUNT,
    },
    stages: overrides.stages ?? strictGlasgowStages(),
    matches: matchEvidence,
    importRuns: [{ id: 'clean-import' }],
  };
}
