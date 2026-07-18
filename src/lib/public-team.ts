import type { Prisma } from '@prisma/client';
import { getPublicCompetitions } from '@/lib/competitions';
import { prisma } from '@/lib/db';

export const MAX_PUBLIC_TEAM_BATCH = 100;

export function publicTeamWhere(publicEditionIds: readonly string[]): Prisma.TeamWhereInput {
  return {
    OR: [
      { competitionId: { in: [...publicEditionIds] } },
      { editionEntries: { some: { competitionId: { in: [...publicEditionIds] } } } },
    ],
  };
}

export async function resolvePublicTeamIds(
  teamIds: readonly string[],
  loadedPublicEditionIds?: readonly string[],
): Promise<ReadonlySet<string>> {
  const uniqueIds = [...new Set(teamIds)];
  if (uniqueIds.length === 0) return new Set();
  if (uniqueIds.length > MAX_PUBLIC_TEAM_BATCH) {
    throw new RangeError(`Public team access batch exceeds ${MAX_PUBLIC_TEAM_BATCH} teams`);
  }

  const publicEditionIds = loadedPublicEditionIds
    ?? (await getPublicCompetitions()).map((edition) => edition.id);
  const teams = await prisma.team.findMany({
    where: {
      id: { in: uniqueIds },
      ...publicTeamWhere(publicEditionIds),
    },
    select: { id: true },
    take: MAX_PUBLIC_TEAM_BATCH,
  });
  return new Set(teams.map((team) => team.id));
}
