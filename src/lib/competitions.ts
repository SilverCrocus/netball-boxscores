import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/db';

export const competitionOptionSelect = {
  id: true,
  season: true,
  name: true,
  seasonStart: true,
  seasonEnd: true,
} as const;

export type CompetitionOption = Awaited<ReturnType<typeof getCompetitions>>[number];

const competitionsQuery = () =>
  prisma.competition.findMany({
    select: competitionOptionSelect,
    orderBy: [{ season: 'desc' }, { id: 'desc' }],
  });

export const getCompetitions = process.env.NODE_ENV === 'test'
  ? competitionsQuery
  : unstable_cache(competitionsQuery, ['competition-list-v1'], {
      revalidate: 3600,
      tags: ['competitions'],
    });

export interface CompetitionResolution {
  competition: CompetitionOption | null;
  competitions: CompetitionOption[];
  wasFallback: boolean;
}

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
