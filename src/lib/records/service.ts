import { Prisma } from '@prisma/client';
import type { AnalyticsCoverageState, AnalyticsEntityType, AnalyticsFact, AnalyticsRawField, MetricAggregation } from '@/lib/analytics';
import { prisma } from '@/lib/db';
import { getPublicCompetitions } from '@/lib/competitions';
import { calculateRecordSnapshot } from '@/lib/records/calculate';
import type { RecordEntity, RecordScope } from '@/lib/records/types';

interface FactRow {
  match_id: string;
  competition_id: string;
  competition_series_id: string;
  competition_kind: 'LEAGUE' | 'TOURNAMENT';
  stage_id: string | null;
  stage_group_id: string | null;
  scheduled_at: Date;
  source_updated_at: Date | null;
  entity_id: string;
  position: string | null;
  box_score_coverage: AnalyticsCoverageState;
  net_points_coverage: AnalyticsCoverageState;
  minutes_played: number;
  goals: number;
  attempts: number;
  goal_assists: number;
  intercepts: number;
  deflections: number;
  rebounds: number;
  penalties: number;
  feeds: number;
  centre_pass_receives: number;
  turnovers: number;
  gains: number;
  pickups: number;
  net_points: number;
  goal_differential: number | null;
  turnover_differential: number | null;
  shooting_percentage_differential: number | null;
}

const statFields: Array<[keyof FactRow, AnalyticsRawField]> = [
  ['minutes_played', 'minutesPlayed'],
  ['goals', 'goals'],
  ['attempts', 'attempts'],
  ['goal_assists', 'goalAssists'],
  ['intercepts', 'intercepts'],
  ['deflections', 'deflections'],
  ['rebounds', 'rebounds'],
  ['penalties', 'penalties'],
  ['feeds', 'feeds'],
  ['centre_pass_receives', 'centrePassReceives'],
  ['turnovers', 'turnovers'],
  ['gains', 'gain'],
  ['pickups', 'pickups'],
  ['net_points', 'netPoints'],
  ['goal_differential', 'goalDifferential'],
  ['turnover_differential', 'turnoverDifferential'],
  ['shooting_percentage_differential', 'shootingPercentageDifferential'],
];

function toFact(row: FactRow, entityType: AnalyticsEntityType): AnalyticsFact {
  const stats: AnalyticsFact['stats'] = {};
  for (const [source, target] of statFields) {
    const value = row[source];
    if (typeof value === 'number') stats[target] = value;
  }
  return {
    entityType,
    entityId: row.entity_id,
    matchId: row.match_id,
    competitionId: row.competition_id,
    competitionSeriesId: row.competition_series_id,
    competitionKind: row.competition_kind,
    stageId: row.stage_id,
    stageGroupId: row.stage_group_id,
    position: row.position,
    scheduledAt: row.scheduled_at,
    sourceUpdatedAt: row.source_updated_at,
    status: 'COMPLETED',
    resultQuality: 'OFFICIAL_FINAL',
    isSimulation: false,
    capabilities: {
      [entityType === 'PLAYER' ? 'PLAYER_BOX_SCORE' : 'TEAM_BOX_SCORE']: row.box_score_coverage,
      NET_POINTS: row.net_points_coverage,
    },
    stats,
  };
}

async function loadFacts(entityType: AnalyticsEntityType, competitionIds: string[]): Promise<AnalyticsFact[]> {
  if (competitionIds.length === 0) return [];
  const rows = entityType === 'PLAYER'
    ? await prisma.$queryRaw<FactRow[]>(Prisma.sql`
      SELECT
        match_id, competition_id, competition_series_id, competition_kind,
        stage_id, stage_group_id, scheduled_at, source_updated_at,
        player_id AS entity_id, position,
        player_box_score_coverage AS box_score_coverage, net_points_coverage,
        minutes_played, goals, attempts, goal_assists, intercepts, deflections,
        rebounds, penalties, feeds, centre_pass_receives, turnovers, gains,
        pickups, net_points,
        NULL::DOUBLE PRECISION AS goal_differential,
        NULL::DOUBLE PRECISION AS turnover_differential,
        NULL::DOUBLE PRECISION AS shooting_percentage_differential
      FROM analytics.player_match_fact
      WHERE competition_id IN (${Prisma.join(competitionIds)})
    `)
    : await prisma.$queryRaw<FactRow[]>(Prisma.sql`
      SELECT
        match_id, competition_id, competition_series_id, competition_kind,
        stage_id, stage_group_id, scheduled_at, source_updated_at,
        team_id AS entity_id, NULL::TEXT AS position,
        team_box_score_coverage AS box_score_coverage, net_points_coverage,
        0::DOUBLE PRECISION AS minutes_played,
        goals, attempts, goal_assists, intercepts, deflections,
        rebounds, penalties, feeds, centre_pass_receives, turnovers, gains,
        pickups, net_points, goal_differential, turnover_differential,
        shooting_percentage_differential
      FROM analytics.team_match_fact
      WHERE competition_id IN (${Prisma.join(competitionIds)})
    `);
  return rows.map((row) => toFact(row, entityType));
}

async function loadEntities(entityType: AnalyticsEntityType, ids: string[]): Promise<RecordEntity[]> {
  if (entityType === 'PLAYER') {
    const players = await prisma.player.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, position: true, team: { select: { name: true } } },
    });
    return players.map((player) => ({ id: player.id, name: player.name, position: player.position, teamName: player.team.name }));
  }
  const teams = await prisma.team.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, slug: true },
  });
  return teams;
}

export interface RecordSnapshotQuery {
  scope: RecordScope;
  metricId: string;
  aggregation: MetricAggregation;
  entityType: AnalyticsEntityType;
  competitionId?: string;
  limit?: number;
}

export async function getRecordSnapshot(query: RecordSnapshotQuery) {
  const entityType: AnalyticsEntityType = query.scope === 'TEAM' ? 'TEAM' : query.entityType;
  const editions = await getPublicCompetitions();
  const selectedEdition = editions.find((edition) => edition.id === query.competitionId);
  const isCrossEdition = query.scope === 'CAREER' || query.scope === 'CENTREPASS_ERA';
  const competitionIds = isCrossEdition ? editions.map((edition) => edition.id) : selectedEdition ? [selectedEdition.id] : [];
  const facts = await loadFacts(entityType, competitionIds);
  const entityIds = [...new Set(facts.map((fact) => fact.entityId))];
  const entities = await loadEntities(entityType, entityIds);
  const finalsStages = selectedEdition && query.scope === 'FINALS'
    ? await prisma.stage.findMany({
      where: { competitionId: selectedEdition.id, type: { in: ['FINALS', 'SEMI_FINALS', 'MEDAL_MATCHES'] } },
      select: { id: true },
    })
    : [];
  const coverageStart = facts.reduce<Date | null>((earliest, fact) => !earliest || fact.scheduledAt < earliest ? fact.scheduledAt : earliest, null)
    ?? (selectedEdition
      ? new Date(Date.UTC(selectedEdition.season, 0, 1))
      : new Date('2025-01-01T00:00:00Z'));

  return calculateRecordSnapshot(facts, entities, {
    scope: query.scope,
    metricId: query.metricId,
    aggregation: query.aggregation,
    entityType,
    competitionId: isCrossEdition ? undefined : selectedEdition?.id,
    competitionLabel: selectedEdition
      ? `${selectedEdition.series?.name ?? selectedEdition.name} · ${selectedEdition.label ?? selectedEdition.season}`
      : undefined,
    finalsStageIds: finalsStages.map((stage) => stage.id),
    coverageStart,
    limit: query.limit,
  });
}
