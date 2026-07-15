import { prisma } from '@/lib/db';
import { getCompetitionPlayerFacts } from '@/lib/player-analytics';
import { calculatePlayerRankingSnapshot } from '@/lib/rankings/player-rankings';
import { calculateTeamPowerSnapshot } from '@/lib/rankings/team-power';
import type { PlayerRankingRequest, TeamPowerMatch } from '@/lib/rankings/types';

export async function getPlayerRankingSnapshot(request: PlayerRankingRequest) {
  const facts = await getCompetitionPlayerFacts(request.competitionId);
  const playerIds = [...new Set(facts.map((fact) => fact.entityId))];
  const players = await prisma.player.findMany({
    where: { id: { in: playerIds } },
    select: {
      id: true,
      name: true,
      position: true,
      team: { select: { name: true } },
    },
  });
  return calculatePlayerRankingSnapshot(
    facts,
    players.map((player) => ({
      id: player.id,
      name: player.name,
      position: player.position,
      teamName: player.team.name,
    })),
    request,
  );
}

export async function getTeamPowerSnapshot(competitionId: string) {
  const matches = await prisma.match.findMany({
    where: {
      competitionId,
      status: 'COMPLETED',
      resultQuality: { in: ['OFFICIAL_FINAL', 'CORRECTED'] },
      isSimulation: false,
      homeTeamId: { not: null },
      awayTeamId: { not: null },
    },
    select: {
      id: true,
      competitionId: true,
      scheduledAt: true,
      sourceUpdatedAt: true,
      neutralVenue: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
      competition: { select: { seriesId: true, series: { select: { kind: true } } } },
    },
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
  });
  const teams = await prisma.editionEntry.findMany({
    where: { competitionId, status: 'ACTIVE' },
    select: {
      team: { select: { id: true, name: true, slug: true, abbreviation: true } },
      displayName: true,
    },
  });
  const powerMatches: TeamPowerMatch[] = matches.flatMap((match) => {
    if (!match.homeTeamId || !match.awayTeamId || !match.competition.seriesId || !match.competition.series) return [];
    return [{
      id: match.id,
      competitionId: match.competitionId,
      competitionSeriesId: match.competition.seriesId,
      competitionKind: match.competition.series.kind,
      scheduledAt: match.scheduledAt,
      sourceUpdatedAt: match.sourceUpdatedAt,
      neutralVenue: match.neutralVenue,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
    }];
  });
  return calculateTeamPowerSnapshot(
    competitionId,
    powerMatches,
    teams.map(({ team, displayName }) => ({
      id: team.id,
      name: displayName ?? team.name,
      slug: team.slug,
      abbreviation: team.abbreviation,
    })),
  );
}

