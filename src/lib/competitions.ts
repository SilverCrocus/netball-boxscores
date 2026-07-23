import { connection } from 'next/server';
import { cache } from 'react';
import type {
  CoverageState,
  DataCapability,
  Prisma,
  PrismaClient,
  PublicationStatus,
  StageType,
} from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  timedQuery,
  trackedUnstableCache,
} from '@/lib/server-timing';
import {
  evaluateGlasgowPublishedVisibility,
  isGlasgow2026Identity,
  GLASGOW_2026_IDENTITY,
  GLASGOW_2026_EXPECTED_MATCH_COUNT,
  GLASGOW_2026_EXPECTED_MATCH_SLOT_COUNT,
  GLASGOW_2026_EXPECTED_STAGE_COUNT,
  GLASGOW_2026_EXPECTED_TEAM_COUNT,
  MIN_PUBLIC_EDITION_MATCHES,
  MIN_PUBLIC_EDITION_TEAMS,
} from '@/lib/edition-publication-readiness';

export const competitionOptionSelect = {
  id: true,
  season: true,
  name: true,
  slug: true,
  label: true,
  seasonStart: true,
  seasonEnd: true,
  sourceTimezone: true,
  publicationStatus: true,
  series: {
    select: {
      id: true,
      slug: true,
      name: true,
      kind: true,
    },
  },
  ruleset: {
    select: {
      id: true,
      slug: true,
      name: true,
      periodCount: true,
      regulationPeriodMinutes: true,
      extraTimePolicy: true,
      scoringModel: true,
      standingsStrategyKey: true,
      superShotsEnabled: true,
      config: true,
    },
  },
  dataCoverage: {
    where: { matchId: null },
    select: {
      capability: true,
      state: true,
      observedAt: true,
    },
  },
  _count: {
    select: {
      entries: { where: { status: 'ACTIVE' } },
      matches: true,
    },
  },
  stages: {
    orderBy: { sequence: 'asc' },
    select: {
      slug: true,
      type: true,
      sequence: true,
      isPublished: true,
      _count: { select: { groups: true, matches: true } },
    },
  },
  matches: {
    select: { _count: { select: { slots: true } } },
  },
  importRuns: {
    where: {
      sourceSystem: { key: 'glasgow-2026-public-data' },
      status: 'SUCCEEDED',
      dryRun: false,
      issueCount: 0,
    },
    select: { id: true },
    take: 1,
  },
} as const;

const competitionsQuery = () => timedQuery(
  'competition_directory',
  () => prisma.competition.findMany({
    select: competitionOptionSelect,
    orderBy: [{ season: 'desc' }, { seasonStart: 'desc' }, { id: 'desc' }],
  }),
);

/**
 * Publication is performed by a standalone CLI process, which cannot
 * invalidate Next's in-process data cache. Keep this small directory query
 * request-scoped so a newly published edition is visible on the next request.
 */
export const getCompetitions = cache(async () => {
  if (process.env.NODE_ENV !== 'test') await connection();
  return competitionsQuery();
});

export type CompetitionOption = Awaited<ReturnType<typeof getCompetitions>>[number];

export interface PublicEditionReadinessOption {
  id: string;
  slug: string | null;
  publicationStatus: PublicationStatus;
  series: { slug: string } | null;
  _count: { entries: number; matches: number; stages?: number };
  stages: Array<{
    slug: string;
    type: StageType;
    sequence: number;
    isPublished: boolean;
    _count: { groups: number; matches: number };
  }>;
  matches: Array<{ _count: { slots: number } }>;
  importRuns: Array<{ id: string }>;
}

/**
 * The smallest edition projection that the public match policy needs after a
 * route has selected a candidate. It deliberately excludes labels, rulesets,
 * and unrelated directory data while retaining the complete publication and
 * capability inputs used by isEditionPubliclyReady and resolveEditionFeatures.
 */
export interface PublicEditionPolicyOption extends PublicEditionReadinessOption {
  dataCoverage: Array<{
    capability: DataCapability;
    state: CoverageState;
  }>;
}

/**
 * Glasgow's strict public contract supplies the exact scalar counts. The
 * route-shaped child evidence reads one extra row so an overflow is observed
 * and rejected instead of being silently truncated. Match slot counts remain
 * scalar per loaded match, so they are never truncated by this projection.
 */
export const LIVE_FALLBACK_GLASGOW_STAGE_EVIDENCE_LIMIT = GLASGOW_2026_EXPECTED_STAGE_COUNT + 1;
export const LIVE_FALLBACK_GLASGOW_MATCH_EVIDENCE_LIMIT = GLASGOW_2026_EXPECTED_MATCH_COUNT + 1;

export const liveFallbackCompetitionSelect = {
  id: true,
  slug: true,
  publicationStatus: true,
  series: { select: { slug: true } },
  dataCoverage: {
    where: { matchId: null },
    select: { capability: true, state: true },
  },
  _count: {
    select: {
      entries: { where: { status: 'ACTIVE' } },
      matches: true,
      stages: true,
    },
  },
  stages: {
    orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
    take: LIVE_FALLBACK_GLASGOW_STAGE_EVIDENCE_LIMIT,
    select: {
      slug: true,
      type: true,
      sequence: true,
      isPublished: true,
      _count: { select: { groups: true, matches: true } },
    },
  },
  matches: {
    orderBy: { id: 'asc' },
    take: LIVE_FALLBACK_GLASGOW_MATCH_EVIDENCE_LIMIT,
    select: { _count: { select: { slots: true } } },
  },
  importRuns: {
    where: {
      sourceSystem: { key: 'glasgow-2026-public-data' },
      status: 'SUCCEEDED',
      dryRun: false,
      issueCount: 0,
    },
    select: { id: true },
    take: 1,
  },
} as const satisfies Prisma.CompetitionSelect;

export type LiveFallbackCompetition = Prisma.CompetitionGetPayload<{
  select: typeof liveFallbackCompetitionSelect;
}>;

export const MAX_LIVE_FALLBACK_COMPETITION_CANDIDATES = 32;
export const LIVE_FALLBACK_COMPETITION_SNAPSHOT_OPTIONS = {
  isolationLevel: 'RepeatableRead' as const,
  maxWait: 1_000,
  timeout: 5_000,
};

export type LiveRelationLoadStrategy = 'join' | 'query';

export {
  GLASGOW_2026_EXPECTED_MATCH_COUNT,
  GLASGOW_2026_EXPECTED_MATCH_SLOT_COUNT,
  GLASGOW_2026_EXPECTED_STAGE_COUNT,
  GLASGOW_2026_EXPECTED_TEAM_COUNT,
  MIN_PUBLIC_EDITION_MATCHES,
  MIN_PUBLIC_EDITION_TEAMS,
};

/**
 * Public visibility is deliberately stricter than the editorial status flag.
 * A mistakenly published shell edition must not leak into selectors, routes,
 * APIs, or analytics until it contains a viable participant and fixture set.
 */
export function isEditionPubliclyReady(edition: PublicEditionReadinessOption): boolean {
  const passesGenericGate = edition.publicationStatus === 'PUBLISHED'
    && edition.series !== null
    && edition.slug !== null
    && edition._count.entries >= MIN_PUBLIC_EDITION_TEAMS
    && edition._count.matches >= MIN_PUBLIC_EDITION_MATCHES;
  if (!passesGenericGate || !isGlasgow2026Identity({
    competitionSlug: edition.series?.slug,
    editionSlug: edition.slug,
  })) {
    return passesGenericGate;
  }

  return evaluateGlasgowPublishedVisibility({
    publicationStatus: edition.publicationStatus,
    teamCount: edition._count.entries,
    matchCount: edition._count.matches,
    matchSlotCount: edition.matches.reduce((total, match) => total + match._count.slots, 0),
    cleanSuccessfulImportCount: edition.importRuns.length,
    stageCount: edition._count.stages,
    stages: edition.stages.map((stage) => ({
      slug: stage.slug,
      type: stage.type,
      sequence: stage.sequence,
      isPublished: stage.isPublished,
      groupCount: stage._count.groups,
      matchCount: stage._count.matches,
    })),
  }).ready;
}

export async function getPublicCompetitions(): Promise<CompetitionOption[]> {
  return (await getCompetitions()).filter(isEditionPubliclyReady);
}

/**
 * Resolve the newest ready edition for the no-live /live fallback. Each page
 * is bounded and route-shaped; readiness is still evaluated in application
 * code so any number of newer published shells cannot displace an older ready
 * edition. A repeatable-read transaction keeps cursor pages on one snapshot,
 * while the selected projection remains sufficient for the later public match
 * access policy and avoids a second edition-readiness query.
 */
export async function loadLiveFallbackCompetitionWithClient(
  database: PrismaClient,
  transactionProbe?: (transaction: Prisma.TransactionClient) => Promise<void>,
  relationLoadStrategy: LiveRelationLoadStrategy = 'join',
): Promise<LiveFallbackCompetition | null> {
  return database.$transaction(async (transaction) => {
    await transactionProbe?.(transaction);
    let cursor: { id: string } | undefined;

    for (;;) {
      const candidates = await timedQuery(
        'live_fallback_competition',
        () => transaction.competition.findMany({
          where: { publicationStatus: 'PUBLISHED' },
          select: liveFallbackCompetitionSelect,
          relationLoadStrategy,
          orderBy: [{ season: 'desc' }, { seasonStart: 'desc' }, { id: 'desc' }],
          take: MAX_LIVE_FALLBACK_COMPETITION_CANDIDATES,
          ...(cursor ? { cursor, skip: 1 } : {}),
        }),
      );

      const ready = candidates.find(isEditionPubliclyReady);
      if (ready) return ready;
      if (candidates.length < MAX_LIVE_FALLBACK_COMPETITION_CANDIDATES) return null;

      const lastCandidate = candidates[candidates.length - 1];
      if (!lastCandidate) return null;
      cursor = { id: lastCandidate.id };
    }
  }, LIVE_FALLBACK_COMPETITION_SNAPSHOT_OPTIONS);
}

export async function loadLiveFallbackCompetition(): Promise<LiveFallbackCompetition | null> {
  return loadLiveFallbackCompetitionWithClient(prisma);
}

/**
 * The global selector needs only route identity and labels. Keep its query
 * independent from rulesets, coverage, rosters, and other page data. Generic
 * publication gates are applied to this small projection; the strict Glasgow
 * gate is checked with a separate, narrowly scoped readiness projection.
 */
export const competitionNavigationSelect = {
  id: true,
  season: true,
  name: true,
  slug: true,
  label: true,
  sourceTimezone: true,
  publicationStatus: true,
  series: {
    select: {
      id: true,
      slug: true,
      name: true,
      kind: true,
    },
  },
  _count: {
    select: {
      entries: { where: { status: 'ACTIVE' } },
      matches: true,
    },
  },
} as const satisfies Prisma.CompetitionSelect;

/**
 * Fresh legacy standings selection. It combines the route identity used by
 * the selector with the strict readiness evidence needed for Glasgow in one
 * bounded relation-join statement. Exact scalar counts remain authoritative;
 * the child evidence limits only cap JSON aggregation and still expose a
 * possible +1 row for rejection.
 */
export const standingsDirectorySelect = {
  ...competitionNavigationSelect,
  _count: {
    select: {
      entries: { where: { status: 'ACTIVE' } },
      matches: true,
      stages: true,
    },
  },
  stages: {
    where: {
      competition: {
        slug: GLASGOW_2026_IDENTITY.editionSlug,
        series: { slug: GLASGOW_2026_IDENTITY.competitionSlug },
      },
    },
    orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
    take: LIVE_FALLBACK_GLASGOW_STAGE_EVIDENCE_LIMIT,
    select: {
      slug: true,
      type: true,
      sequence: true,
      isPublished: true,
      _count: { select: { groups: true, matches: true } },
    },
  },
  matches: {
    where: {
      competition: {
        slug: GLASGOW_2026_IDENTITY.editionSlug,
        series: { slug: GLASGOW_2026_IDENTITY.competitionSlug },
      },
    },
    orderBy: { id: 'asc' },
    take: LIVE_FALLBACK_GLASGOW_MATCH_EVIDENCE_LIMIT,
    select: { _count: { select: { slots: true } } },
  },
  importRuns: {
    where: {
      sourceSystem: { key: 'glasgow-2026-public-data' },
      status: 'SUCCEEDED',
      dryRun: false,
      issueCount: 0,
    },
    select: { id: true },
    take: 1,
  },
} as const satisfies Prisma.CompetitionSelect;

const competitionNavigationReadinessSelect = {
  id: true,
  slug: true,
  publicationStatus: true,
  series: { select: { slug: true } },
  _count: {
    select: {
      entries: { where: { status: 'ACTIVE' } },
      matches: true,
    },
  },
  stages: {
    orderBy: { sequence: 'asc' },
    select: {
      slug: true,
      type: true,
      sequence: true,
      isPublished: true,
      _count: { select: { groups: true, matches: true } },
    },
  },
  matches: {
    select: { _count: { select: { slots: true } } },
  },
  importRuns: {
    where: {
      sourceSystem: { key: 'glasgow-2026-public-data' },
      status: 'SUCCEEDED',
      dryRun: false,
      issueCount: 0,
    },
    select: { id: true },
    take: 1,
  },
} as const satisfies Prisma.CompetitionSelect;

export type CompetitionNavigationOption = Prisma.CompetitionGetPayload<{
  select: typeof competitionNavigationSelect;
}>;

export const COMPETITION_NAVIGATION_CACHE_TAG = 'competition-navigation';

function passesGenericNavigationGate(edition: CompetitionNavigationOption): boolean {
  return edition.publicationStatus === 'PUBLISHED'
    && edition.series !== null
    && edition.slug !== null
    && edition._count.entries >= MIN_PUBLIC_EDITION_TEAMS
    && edition._count.matches >= MIN_PUBLIC_EDITION_MATCHES;
}

export async function loadPublicCompetitionNavigationDirectoryWithClient(
  database: PrismaClient,
): Promise<CompetitionNavigationOption[]> {
  const candidates = await timedQuery(
    'competition_navigation_directory',
    () => database.competition.findMany({
      where: { publicationStatus: 'PUBLISHED' },
      select: competitionNavigationSelect,
      orderBy: [{ season: 'desc' }, { seasonStart: 'desc' }, { id: 'desc' }],
    }),
  );
  const genericReady = candidates.filter(passesGenericNavigationGate);
  const strictCandidates = genericReady.filter((edition) => isGlasgow2026Identity({
    competitionSlug: edition.series?.slug,
    editionSlug: edition.slug,
  }));

  if (strictCandidates.length === 0) return genericReady;

  const strictReadiness = await timedQuery(
    'competition_navigation_readiness',
    () => database.competition.findMany({
      where: { id: { in: strictCandidates.map((edition) => edition.id) } },
      select: competitionNavigationReadinessSelect,
    }),
  );
  const readyStrictIds = new Set(
    strictReadiness
      .filter(isEditionPubliclyReady)
      .map((edition) => edition.id),
  );

  return genericReady.filter((edition) => (
    !strictCandidates.some((candidate) => candidate.id === edition.id)
      || readyStrictIds.has(edition.id)
  ));
}

export async function loadPublicCompetitionNavigationDirectory(): Promise<CompetitionNavigationOption[]> {
  return loadPublicCompetitionNavigationDirectoryWithClient(prisma);
}

export type StandingsDirectoryOption = Prisma.CompetitionGetPayload<{
  select: typeof standingsDirectorySelect;
}>;

export async function loadFreshStandingsCompetitionDirectoryWithClient(
  database: PrismaClient,
): Promise<StandingsDirectoryOption[]> {
  const candidates = await timedQuery(
    'standings_directory',
    () => database.competition.findMany({
      where: { publicationStatus: 'PUBLISHED' },
      select: standingsDirectorySelect,
      relationLoadStrategy: 'join',
      orderBy: [{ season: 'desc' }, { seasonStart: 'desc' }, { id: 'desc' }],
    }),
  );

  return candidates.filter(isEditionPubliclyReady);
}

export async function loadFreshStandingsCompetitionDirectory(): Promise<StandingsDirectoryOption[]> {
  return loadFreshStandingsCompetitionDirectoryWithClient(prisma);
}

const getCachedPublicCompetitionNavigationDirectory = process.env.NODE_ENV === 'test'
  ? loadPublicCompetitionNavigationDirectory
  : trackedUnstableCache(
      'competition_navigation_directory',
      loadPublicCompetitionNavigationDirectory,
      ['competition-navigation-directory-v1'],
      {
        revalidate: 180,
        tags: [COMPETITION_NAVIGATION_CACHE_TAG],
      },
    );

export async function getPublicCompetitionNavigationDirectory(options: {
  cache?: boolean;
} = {}): Promise<CompetitionNavigationOption[]> {
  return options.cache === false
    ? loadFreshStandingsCompetitionDirectory()
    : getCachedPublicCompetitionNavigationDirectory();
}

export interface EditionRouteIdentity {
  competitionSlug: string;
  editionSlug: string;
}

export interface EditionResolution {
  edition: CompetitionOption | null;
  editions: CompetitionOption[];
}

export function selectEditionBySlugs(
  editions: CompetitionOption[],
  identity: EditionRouteIdentity
): CompetitionOption | null {
  return editions.find((edition) =>
    isEditionPubliclyReady(edition)
      && edition.series?.slug === identity.competitionSlug
      && edition.slug === identity.editionSlug
  ) ?? null;
}

/**
 * Resolve a public edition route exactly. This function deliberately has no
 * latest-edition fallback: a typo must become a 404 rather than another event.
 */
export async function resolveEdition(
  identity: EditionRouteIdentity
): Promise<EditionResolution> {
  const publicEditions = await getPublicCompetitions();

  return {
    edition: selectEditionBySlugs(publicEditions, identity),
    editions: publicEditions,
  };
}

export interface CompetitionResolution {
  competition: CompetitionOption | null;
  competitions: CompetitionOption[];
  wasFallback: boolean;
}

/** Resolve a public edition by its canonical database identity without a fallback. */
export async function resolveCompetitionById(
  competitionId: string,
): Promise<CompetitionResolution> {
  const competitions = await getPublicCompetitions();
  const selected = competitions.find((competition) => competition.id === competitionId) ?? null;

  return {
    competition: selected,
    competitions,
    wasFallback: false,
  };
}

/**
 * Compatibility resolver for pre-edition SSN URLs. A numeric year cannot
 * identify both a league and a tournament, so legacy `season` consumers stay
 * explicitly league-scoped while new surfaces use canonical edition ids.
 */
export async function resolveLegacyLeagueCompetition(
  season?: string,
): Promise<CompetitionResolution> {
  const competitions = (await getPublicCompetitions()).filter(
    (competition) => competition.series?.kind === 'LEAGUE',
  );
  const latest = competitions[0] ?? null;

  if (!season) {
    return { competition: latest, competitions, wasFallback: false };
  }

  const parsedSeason = Number(season);
  const selected = Number.isInteger(parsedSeason)
    ? competitions.find((competition) => competition.season === parsedSeason) ?? null
    : null;

  return {
    competition: selected ?? latest,
    competitions,
    wasFallback: selected === null,
  };
}

/**
 * Compatibility resolver for legacy routes. New edition-aware routes must use
 * resolveEdition so two competitions sharing a year cannot be confused.
 */
export async function resolveCompetition(season?: string): Promise<CompetitionResolution> {
  const competitions = await getPublicCompetitions();
  const latest = competitions[0] ?? null;

  if (!season) {
    return { competition: latest, competitions, wasFallback: false };
  }

  const parsedSeason = Number(season);
  const selected = Number.isInteger(parsedSeason)
    ? competitions.find((competition) => competition.season === parsedSeason) ?? null
    : null;

  return {
    competition: selected ?? latest,
    competitions,
    wasFallback: selected === null,
  };
}
