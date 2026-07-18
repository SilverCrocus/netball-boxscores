import { calculateMetric, getMetricDefinition } from '@/lib/analytics';
import type {
  AnalyticsFact,
  AnalyticsRawField,
  MetricAggregation,
  MetricResult,
} from '@/lib/analytics';
import {
  readAnalyticsPlayerFacts,
  type AnalyticsPlayerFactRow,
} from '@/lib/analytics/repository';
import { calculateCentrePassImpact, type CentrePassImpactResult } from '@/lib/player-impact';

export type PlayerFactRow = AnalyticsPlayerFactRow;

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

export function toPlayerAnalyticsFact(row: PlayerFactRow): AnalyticsFact {
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

export async function getCompetitionPlayerFacts(competitionId: string): Promise<AnalyticsFact[]> {
  const rows = await readAnalyticsPlayerFacts([competitionId]);
  return rows.map(toPlayerAnalyticsFact);
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
  const facts = await getCompetitionPlayerFacts(competitionId);
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
