import { Prisma } from '@prisma/client';
import type { AnalyticsCoverageState, AnalyticsFact, AnalyticsRawField } from '@/lib/analytics';
import { prisma } from '@/lib/db';
import { calculatePlayerComparison } from '@/lib/comparison/calculate';
import type { PlayerComparisonRequest } from '@/lib/comparison/types';

interface PlayerFactRow {
  match_id: string; competition_id: string; competition_series_id: string;
  competition_kind: 'LEAGUE' | 'TOURNAMENT'; stage_id: string | null; stage_group_id: string | null;
  scheduled_at: Date; source_updated_at: Date | null; player_id: string; position: string;
  player_box_score_coverage: AnalyticsCoverageState; net_points_coverage: AnalyticsCoverageState;
  minutes_played: number; goals: number; attempts: number; goal_assists: number;
  intercepts: number; deflections: number; rebounds: number; penalties: number;
  feeds: number; centre_pass_receives: number; turnovers: number; gains: number;
  pickups: number; net_points: number;
}

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
  const rows = await prisma.$queryRaw<PlayerFactRow[]>(Prisma.sql`
    SELECT match_id, competition_id, competition_series_id, competition_kind,
      stage_id, stage_group_id, scheduled_at, source_updated_at, player_id, position,
      player_box_score_coverage, net_points_coverage, minutes_played, goals, attempts,
      goal_assists, intercepts, deflections, rebounds, penalties, feeds,
      centre_pass_receives, turnovers, gains, pickups, net_points
    FROM analytics.player_match_fact
    WHERE competition_id IN (${Prisma.join(competitionIds)})
  `);
  const facts = rows.map(toFact);
  const playerIds = [...new Set(facts.map((fact) => fact.entityId))];
  const players = await prisma.player.findMany({
    where: { id: { in: playerIds } },
    select: { id: true, name: true, position: true, team: { select: { name: true } } },
  });
  return calculatePlayerComparison(facts, players.map((player) => ({
    id: player.id, name: player.name, position: player.position, teamName: player.team.name,
  })), request);
}

export async function getComparisonPlayers(competitionId: string) {
  const playerIds = await prisma.playerMatchStats.findMany({
    where: { match: { competitionId, status: 'COMPLETED', resultQuality: { in: ['OFFICIAL_FINAL', 'CORRECTED'] }, isSimulation: false } },
    distinct: ['playerId'], select: { playerId: true },
  });
  return prisma.player.findMany({
    where: { id: { in: playerIds.map((item) => item.playerId) } },
    select: { id: true, name: true, position: true, team: { select: { name: true } } },
    orderBy: [{ name: 'asc' }],
  });
}

