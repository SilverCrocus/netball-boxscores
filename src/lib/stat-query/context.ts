import { listAnalyticsEditions, readParserDirectory } from '@/lib/analytics/repository';
import type { ParserContext } from '@/lib/stat-query/types';

export async function loadParserContext(): Promise<ParserContext> {
  const [editions, directory] = await Promise.all([
    listAnalyticsEditions(),
    readParserDirectory(),
  ]);
  return {
    entities: [
      ...directory.players.map((player) => ({ id: player.id, kind: 'PLAYER' as const, name: player.name, aliases: player.aliases, position: player.position })),
      ...directory.teams.map((team) => ({ id: team.id, kind: 'TEAM' as const, name: team.name, aliases: [team.abbreviation, ...team.aliases] })),
    ],
    editions: editions.map((edition) => ({
      id: edition.id, name: `${edition.series.name} ${edition.label ?? edition.season}`,
      aliases: [edition.name, edition.slug, edition.series.name, edition.series.slug, String(edition.season), edition.label ?? ''].filter(Boolean),
    })),
    stages: directory.stages.map((stage) => ({
      id: stage.id, competitionId: stage.competitionId, name: stage.name,
      aliases: [stage.slug, stage.type.replaceAll('_', ' ')],
    })),
    groups: directory.groups.map((group) => ({ id: group.id, competitionId: group.competitionId, name: group.name, aliases: [group.slug] })),
    defaultEditionId: editions[0]?.id,
  };
}
