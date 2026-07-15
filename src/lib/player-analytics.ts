import { Prisma } from '@prisma/client';
import { calculateMetric, getMetricDefinition } from '@/lib/analytics';
import type {
  AnalyticsCoverageState,
  AnalyticsFact,
  AnalyticsRawField,
  MetricAggregation,
  MetricResult,
} from '@/lib/analytics';
import { prisma } from '@/lib/db';
import { calculateCentrePassImpact, type CentrePassImpactResult } from '@/lib/player-impact';

interface PlayerFactRow {
  match_id: string;
  competition_id: string;
  competition_series_id: string;
  competition_kind: 'LEAGUE' | 'TOURNAMENT';
  stage_id: string | null;
  stage_group_id: string | null;
  scheduled_at: Date;
  source_updated_at: Date | null;
  player_id: string;
  position: string;
  player_box_score_coverage: AnalyticsCoverageState;
  net_points_coverage: AnalyticsCoverageState;
  super_shots_coverage: AnalyticsCoverageState;
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
}

export interface DisplayMetric {
  displayName: string;
  definition: string;
  result: MetricResult;
}

export interface PlayerAnalyticsProfile {
  metrics: DisplayMetric[];
  recentForm: DisplayMetric | null;
  officialNetPoints: DisplayMetric | null;
  impact: CentrePassImpactResult;
  superShotMatchIds: string[];
}

const statFieldMap: Record<string, AnalyticsRawField> = {
  minutes_played: 'minutesPlayed',
  goals: 'goals',
  attempts: 'attempts',
  goal_assists: 'goalAssists',
  intercepts: 'intercepts',
  deflections: 'deflections',
  rebounds: 'rebounds',
  penalties: 'penalties',
  feeds: 'feeds',
  centre_pass_receives: 'centrePassReceives',
  turnovers: 'turnovers',
  gains: 'gain',
  pickups: 'pickups',
  net_points: 'netPoints',
};

function toFact(row: PlayerFactRow): AnalyticsFact {
  const stats: AnalyticsFact['stats'] = {};
  for (const [sourceField, targetField] of Object.entries(statFieldMap)) {
    stats[targetField] = row[sourceField as keyof PlayerFactRow] as number;
  }
  return {
    entityType: 'PLAYER',
    entityId: row.player_id,
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
      PLAYER_BOX_SCORE: row.player_box_score_coverage,
      NET_POINTS: row.net_points_coverage,
      SUPER_SHOTS: row.super_shots_coverage,
    },
    stats,
  };
}

function displayMetric(
  metricId: string,
  facts: readonly AnalyticsFact[],
  playerId: string,
  competitionId: string,
  aggregation: MetricAggregation,
  lastN?: number,
): DisplayMetric {
  const definition = getMetricDefinition(metricId);
  if (!definition) throw new Error(`Metric catalogue entry missing: ${metricId}`);
  return {
    displayName: definition.displayName,
    definition: definition.definition,
    result: calculateMetric(metricId, facts, {
      entityType: 'PLAYER',
      entityId: playerId,
      competitionId,
      ...(lastN ? { window: { lastN } } : {}),
    }, aggregation),
  };
}

function metricSelection(position: string): Array<[string, MetricAggregation]> {
  if (position === 'GS' || position === 'GA') {
    return [
      ['goal_accuracy', 'WEIGHTED_PERCENTAGE'],
      ['shooting_volume', 'PER_60'],
      ['attacking_involvement', 'PER_60'],
      ['turnovers', 'PER_60'],
      ['penalties', 'PER_60'],
    ];
  }
  if (position === 'GD' || position === 'GK') {
    return [
      ['defensive_activity', 'PER_60'],
      ['intercepts', 'PER_60'],
      ['gain_to_turnover_ratio', 'RATING'],
      ['turnovers', 'PER_60'],
      ['penalties', 'PER_60'],
    ];
  }
  return [
    ['attacking_involvement', 'PER_60'],
    ['defensive_activity', 'PER_60'],
    ['gain_to_turnover_ratio', 'RATING'],
    ['turnovers', 'PER_60'],
    ['penalties', 'PER_60'],
  ];
}

export async function getPlayerAnalyticsProfile(
  playerId: string,
  competitionId: string,
  position: string,
): Promise<PlayerAnalyticsProfile> {
  const rows = await prisma.$queryRaw<PlayerFactRow[]>(Prisma.sql`
    SELECT
      match_id,
      competition_id,
      competition_series_id,
      competition_kind,
      stage_id,
      stage_group_id,
      scheduled_at,
      source_updated_at,
      player_id,
      position,
      player_box_score_coverage,
      net_points_coverage,
      super_shots_coverage,
      minutes_played,
      goals,
      attempts,
      goal_assists,
      intercepts,
      deflections,
      rebounds,
      penalties,
      feeds,
      centre_pass_receives,
      turnovers,
      gains,
      pickups,
      net_points
    FROM analytics.player_match_fact
    WHERE competition_id = ${competitionId}
  `);
  const facts = rows.map(toFact);
  const playerFacts = facts.filter((fact) => fact.entityId === playerId);
  const metrics = metricSelection(position).map(([metricId, aggregation]) =>
    displayMetric(metricId, playerFacts, playerId, competitionId, aggregation),
  );
  const recentMetricId = position === 'GS' || position === 'GA'
    ? 'goals'
    : position === 'GD' || position === 'GK'
      ? 'defensive_activity'
      : 'attacking_involvement';
  const recentForm = playerFacts.length > 0
    ? displayMetric(recentMetricId, playerFacts, playerId, competitionId, 'PER_GAME', 5)
    : null;
  const netPoints = displayMetric('net_points', playerFacts, playerId, competitionId, 'PER_GAME');

  return {
    metrics,
    recentForm,
    officialNetPoints: netPoints.result.status === 'UNAVAILABLE' ? null : netPoints,
    impact: calculateCentrePassImpact(facts, playerId, competitionId, position),
    superShotMatchIds: playerFacts
      .filter((fact) => ['AVAILABLE', 'PARTIAL'].includes(fact.capabilities.SUPER_SHOTS ?? 'UNAVAILABLE'))
      .map((fact) => fact.matchId),
  };
}
