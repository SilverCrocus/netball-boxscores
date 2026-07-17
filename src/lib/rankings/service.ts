import {
  readComparisonPlayers,
  readEditionTeams,
  readTeamPowerMatches,
} from '@/lib/analytics/repository';
import { getCompetitionPlayerFacts } from '@/lib/player-analytics';
import { calculatePlayerRankingSnapshot } from '@/lib/rankings/player-rankings';
import { calculateTeamPowerSnapshot } from '@/lib/rankings/team-power';
import type { PlayerRankingRequest, TeamPowerMatch } from '@/lib/rankings/types';

export async function getPlayerRankingSnapshot(request: PlayerRankingRequest) {
  const facts = await getCompetitionPlayerFacts(request.competitionId);
  const playerIds = [...new Set(facts.map((fact) => fact.entityId))];
  const playerIdSet = new Set(playerIds);
  const players = (await readComparisonPlayers(request.competitionId))
    .filter((player) => playerIdSet.has(player.id));
  return calculatePlayerRankingSnapshot(
    facts,
    players.map((player) => ({
      id: player.id,
      name: player.name,
      position: player.position,
      teamName: player.teamName,
    })),
    request,
  );
}

export async function getTeamPowerSnapshot(competitionId: string) {
  const [matches, teams] = await Promise.all([
    readTeamPowerMatches(competitionId),
    readEditionTeams(competitionId),
  ]);
  const powerMatches: TeamPowerMatch[] = matches.map((match) => ({
    id: match.match_id,
    competitionId: match.competition_id,
    competitionSeriesId: match.competition_series_id,
    competitionKind: match.competition_kind,
    scheduledAt: match.scheduled_at,
    sourceUpdatedAt: match.source_updated_at,
    neutralVenue: match.neutral_venue,
    homeTeamId: match.home_team_id,
    awayTeamId: match.away_team_id,
    homeScore: match.home_score,
    awayScore: match.away_score,
  }));
  return calculateTeamPowerSnapshot(
    competitionId,
    powerMatches,
    teams.map((team) => ({
      id: team.id,
      name: team.name,
      slug: team.slug,
      abbreviation: team.abbreviation,
    })),
  );
}
