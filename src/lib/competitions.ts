import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/db';

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
} as const;

const competitionsQuery = () =>
  prisma.competition.findMany({
    select: competitionOptionSelect,
    orderBy: [{ season: 'desc' }, { seasonStart: 'desc' }, { id: 'desc' }],
  });

export const getCompetitions = process.env.NODE_ENV === 'test'
  ? competitionsQuery
  : unstable_cache(competitionsQuery, ['competition-directory-v2'], {
      revalidate: 3600,
      tags: ['competitions'],
    });

export type CompetitionOption = Awaited<ReturnType<typeof getCompetitions>>[number];

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
    edition.publicationStatus === 'PUBLISHED'
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
  const editions = await getCompetitions();
  const publicEditions = editions.filter((edition) =>
    edition.publicationStatus === 'PUBLISHED'
      && edition.series !== null
      && edition.slug !== null
  );

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

/**
 * Compatibility resolver for legacy routes. New edition-aware routes must use
 * resolveEdition so two competitions sharing a year cannot be confused.
 */
export async function resolveCompetition(season?: string): Promise<CompetitionResolution> {
  const competitions = await getCompetitions();
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
