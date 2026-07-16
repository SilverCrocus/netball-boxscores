import { connection } from 'next/server';
import { cache } from 'react';
import { prisma } from '@/lib/db';
import {
  evaluateEditionPublicationReadiness,
  isGlasgow2026Identity,
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

const competitionsQuery = () =>
  prisma.competition.findMany({
    select: competitionOptionSelect,
    orderBy: [{ season: 'desc' }, { seasonStart: 'desc' }, { id: 'desc' }],
  });

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

export { MIN_PUBLIC_EDITION_MATCHES, MIN_PUBLIC_EDITION_TEAMS };

/**
 * Public visibility is deliberately stricter than the editorial status flag.
 * A mistakenly published shell edition must not leak into selectors, routes,
 * APIs, or analytics until it contains a viable participant and fixture set.
 */
export function isEditionPubliclyReady(edition: CompetitionOption): boolean {
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

  return evaluateEditionPublicationReadiness({
    competitionSlug: edition.series?.slug,
    editionSlug: edition.slug,
    publicationStatus: edition.publicationStatus,
    teamCount: edition._count.entries,
    matchCount: edition._count.matches,
    matchSlotCount: edition.matches.reduce((total, match) => total + match._count.slots, 0),
    cleanSuccessfulImportCount: edition.importRuns.length,
    requirePublishedStages: true,
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
