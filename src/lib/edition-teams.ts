import { prisma } from '@/lib/db';

const EDITION_TEAM_SELECT = {
  id: true,
  seed: true,
  displayName: true,
  primaryGroup: {
    select: {
      name: true,
    },
  },
  team: {
    select: {
      id: true,
      name: true,
      slug: true,
      abbreviation: true,
      logoUrl: true,
    },
  },
  _count: {
    select: {
      roster: {
        where: { status: 'ACTIVE' as const },
      },
    },
  },
} as const;

export interface EditionTeamDirectoryEntry {
  entryId: string;
  displayName: string;
  seed: number | null;
  poolName: string | null;
  rosterCount: number;
  team: {
    id: string;
    name: string;
    slug: string;
    abbreviation: string;
    logoUrl: string | null;
  };
}

export async function getEditionTeams(
  competitionId: string,
): Promise<EditionTeamDirectoryEntry[]> {
  const entries = await prisma.editionEntry.findMany({
    where: {
      competitionId,
      status: 'ACTIVE',
    },
    select: EDITION_TEAM_SELECT,
  });

  return entries
    .map((entry) => ({
      entryId: entry.id,
      displayName: entry.displayName?.trim() || entry.team.name,
      seed: entry.seed,
      poolName: entry.primaryGroup?.name ?? null,
      rosterCount: entry._count.roster,
      team: entry.team,
    }))
    .sort((left, right) => {
      const groupOrder = (left.poolName ?? '').localeCompare(right.poolName ?? '');
      const seedOrder = (left.seed ?? Number.MAX_SAFE_INTEGER)
        - (right.seed ?? Number.MAX_SAFE_INTEGER);

      return groupOrder || seedOrder || left.displayName.localeCompare(right.displayName);
    });
}
