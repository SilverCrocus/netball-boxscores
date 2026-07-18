import type { AnalyticsFact, AnalyticsRawField } from '@/lib/analytics';
import {
  readAnalyticsPlayerFacts,
  readAnalyticsPlayers,
  readComparisonPlayers,
  type AnalyticsPlayerFactRow,
} from '@/lib/analytics/repository';
import { calculatePlayerComparison } from '@/lib/comparison/calculate';
import type { PlayerComparisonRequest } from '@/lib/comparison/types';

type PlayerFactRow = AnalyticsPlayerFactRow;

const fields: Array<[keyof PlayerFactRow, AnalyticsRawField]> = [
  ['minutes_played', 'minutesPlayed'], ['goals', 'goals'], ['attempts', 'attempts'],
  ['goal_assists', 'goalAssists'], ['intercepts', 'intercepts'], ['deflections', 'deflections'],
  ['rebounds', 'rebounds'], ['penalties', 'penalties'], ['feeds', 'feeds'],
  ['centre_pass_receives', 'centrePassReceives'], ['turnovers', 'turnovers'], ['gains', 'gain'],
  ['pickups', 'pickups'], ['net_points', 'netPoints'],
];

function toFact(row: PlayerFactRow): AnalyticsFact {
  const stats: AnalyticsFact['stats'] = {};
  for (const [source, target] of fields) stats[target] = row[source] as number;
  return {
    entityType: 'PLAYER', entityId: row.player_id, matchId: row.match_id,
    competitionId: row.competition_id, competitionSeriesId: row.competition_series_id,
    competitionKind: row.competition_kind, stageId: row.stage_id, stageGroupId: row.stage_group_id,
    position: row.position, scheduledAt: row.scheduled_at, sourceUpdatedAt: row.source_updated_at,
    status: 'COMPLETED', resultQuality: 'OFFICIAL_FINAL', isSimulation: false,
    capabilities: { PLAYER_BOX_SCORE: row.player_box_score_coverage, NET_POINTS: row.net_points_coverage }, stats,
  };
}

export async function getPlayerComparison(request: PlayerComparisonRequest) {
  const competitionIds = [...new Set([request.leftCompetitionId, request.rightCompetitionId])];
  const rows = await readAnalyticsPlayerFacts(competitionIds);
  const facts = rows.map(toFact);
  const playerIds = [...new Set(facts.map((fact) => fact.entityId))];
  const players = request.leftCompetitionId === request.rightCompetitionId
    ? await readAnalyticsPlayers(playerIds, request.leftCompetitionId)
    : (await Promise.all([
      readAnalyticsPlayers([request.leftPlayerId], request.leftCompetitionId),
      readAnalyticsPlayers([request.rightPlayerId], request.rightCompetitionId),
    ])).flat();
  return calculatePlayerComparison(facts, players.map((player) => ({
    id: player.id, name: player.name, position: player.position, teamName: player.teamName,
  })), request);
}

export async function getComparisonPlayers(competitionId: string) {
  return readComparisonPlayers(competitionId);
}
