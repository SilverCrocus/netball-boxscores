import { prisma } from '@/lib/db';
import { getPublicCompetitions } from '@/lib/competitions';
import type { ParserContext } from '@/lib/stat-query/types';

export async function loadParserContext(): Promise<ParserContext> {
  const editions = await getPublicCompetitions();
  const publicEditionIds = editions.map((edition) => edition.id);
  const [players, teams, stages] = await Promise.all([
    prisma.player.findMany({
      where: {
        OR: [
          { team: { competitionId: { in: publicEditionIds } } },
          { rosterMemberships: { some: { editionEntry: { competitionId: { in: publicEditionIds } } } } },
        ],
      },
      select: { id: true, name: true, position: true, aliases: { select: { alias: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.team.findMany({
      where: {
        OR: [
          { competitionId: { in: publicEditionIds } },
          { editionEntries: { some: { competitionId: { in: publicEditionIds } } } },
        ],
      },
      select: { id: true, name: true, abbreviation: true, aliases: { select: { alias: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.stage.findMany({
      where: { competitionId: { in: publicEditionIds } },
      select: { id: true, competitionId: true, name: true, slug: true, type: true, groups: { select: { id: true, name: true, slug: true } } },
    }),
  ]);
  return {
    entities: [
      ...players.map((player) => ({ id: player.id, kind: 'PLAYER' as const, name: player.name, aliases: player.aliases.map((alias) => alias.alias), position: player.position })),
      ...teams.map((team) => ({ id: team.id, kind: 'TEAM' as const, name: team.name, aliases: [team.abbreviation, ...team.aliases.map((alias) => alias.alias)] })),
    ],
    editions: editions.map((edition) => ({
      id: edition.id,
      name: `${edition.series?.name ?? edition.name} ${edition.label ?? edition.season}`,
      aliases: [edition.name, edition.slug ?? '', edition.series?.name ?? '', edition.series?.slug ?? '', String(edition.season), edition.label ?? ''].filter(Boolean),
    })),
    stages: stages.map((stage) => ({
      id: stage.id, competitionId: stage.competitionId, name: stage.name,
      aliases: [stage.slug, stage.type.replaceAll('_', ' ')],
    })),
    groups: stages.flatMap((stage) => stage.groups.map((group) => ({
      id: group.id, competitionId: stage.competitionId, name: group.name, aliases: [group.slug],
    }))),
    defaultEditionId: editions[0]?.id,
  };
}
