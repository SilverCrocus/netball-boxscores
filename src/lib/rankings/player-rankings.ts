import { calculateMetric, getMetricDefinition } from '@/lib/analytics';
import type { AnalyticsFact, MetricResult } from '@/lib/analytics';
import { calculateCentrePassImpact } from '@/lib/player-impact';
import {
  PLAYER_RANKING_METHOD_VERSION,
  type PlayerRankingRequest,
  type PlayerRankingSnapshot,
  type RankingEntity,
} from '@/lib/rankings/types';

function validateRequest(request: PlayerRankingRequest): void {
  if (!Number.isFinite(request.minimumMinutes) || request.minimumMinutes < 0 || request.minimumMinutes > 10_000) {
    throw new Error('minimumMinutes must be between 0 and 10000');
  }
  if (request.lastN !== undefined && (!Number.isInteger(request.lastN) || request.lastN < 1 || request.lastN > 100)) {
    throw new Error('lastN must be an integer between 1 and 100');
  }
}

function impactAsMetricResult(
  facts: readonly AnalyticsFact[],
  entity: RankingEntity,
  request: PlayerRankingRequest,
): MetricResult {
  const impact = calculateCentrePassImpact(facts, entity.id, request.competitionId, entity.position ?? 'C');
  const minimumSampleMet = impact.minutes >= Math.max(30, request.minimumMinutes);
  return {
    metricId: impact.metricId,
    value: impact.value,
    status: impact.status === 'AVAILABLE' && !minimumSampleMet ? 'INSUFFICIENT_SAMPLE' : impact.status,
    unit: 'RATING',
    aggregation: 'RATING',
    context: {
      entityType: 'PLAYER',
      entityId: entity.id,
      competitionId: request.competitionId,
      ...(request.lastN ? { window: { lastN: request.lastN } } : {}),
    },
    games: impact.games,
    minutes: impact.minutes,
    minimumSample: { minutes: Math.max(30, request.minimumMinutes) },
    minimumSampleMet,
    coverage: impact.coverage,
    formulaVersion: impact.formulaVersion,
    asOf: impact.asOf,
    includedMatchIds: impact.includedMatchIds,
  };
}

function lastNFactsByPlayer(facts: readonly AnalyticsFact[], lastN?: number): AnalyticsFact[] {
  if (!lastN) return [...facts];
  const grouped = new Map<string, AnalyticsFact[]>();
  for (const fact of facts) {
    const values = grouped.get(fact.entityId) ?? [];
    values.push(fact);
    grouped.set(fact.entityId, values);
  }
  return [...grouped.values()].flatMap((values) => values
    .toSorted((left, right) => right.scheduledAt.getTime() - left.scheduledAt.getTime() || right.matchId.localeCompare(left.matchId))
    .slice(0, lastN));
}

function scopeKey(request: PlayerRankingRequest): string {
  return [
    `edition:${request.competitionId}`,
    `metric:${request.metricId}`,
    `aggregation:${request.aggregation}`,
    `position:${request.position ?? 'ALL'}`,
    `stage:${request.stageId ?? 'ALL'}`,
    `group:${request.stageGroupId ?? 'ALL'}`,
    `window:${request.lastN ? `LAST_${request.lastN}` : 'EDITION'}`,
    `from:${request.from?.toISOString() ?? 'START'}`,
    `to:${request.to?.toISOString() ?? 'END'}`,
    `minimum_minutes:${request.minimumMinutes}`,
  ].join('|');
}

export function calculatePlayerRankingSnapshot(
  facts: readonly AnalyticsFact[],
  entities: readonly RankingEntity[],
  request: PlayerRankingRequest,
): PlayerRankingSnapshot {
  validateRequest(request);
  const metric = getMetricDefinition(request.metricId);
  if (!metric || !metric.entityTypes.includes('PLAYER')) {
    throw new Error(`Unknown player metric: ${request.metricId}`);
  }
  if (!metric.allowedAggregations.includes(request.aggregation)) {
    throw new Error(`${request.aggregation} is not supported for ${request.metricId}`);
  }

  const impactFacts = lastNFactsByPlayer(facts, request.lastN);
  const candidates = entities.filter((entity) => !request.position || entity.position === request.position);
  const eligible = candidates.flatMap((entity) => {
    const result = request.metricId === 'centrepass_impact'
      ? impactAsMetricResult(impactFacts, entity, request)
      : calculateMetric(request.metricId, facts, {
        entityType: 'PLAYER',
        entityId: entity.id,
        competitionId: request.competitionId,
        ...(request.stageId ? { stageId: request.stageId } : {}),
        ...(request.stageGroupId ? { stageGroupId: request.stageGroupId } : {}),
        ...(request.lastN || request.from || request.to ? { window: { lastN: request.lastN, from: request.from, to: request.to } } : {}),
      }, request.aggregation);
    if (result.status !== 'AVAILABLE' || result.value === null || result.minutes < request.minimumMinutes) return [];
    return [{ entity, result }];
  });

  eligible.sort((left, right) => {
    const valueDifference = metric.higherIsBetter
      ? right.result.value! - left.result.value!
      : left.result.value! - right.result.value!;
    return valueDifference || left.entity.name.localeCompare(right.entity.name);
  });
  const populationSize = eligible.length;
  const entries = eligible.map(({ entity, result }, index) => ({
    rank: index + 1,
    percentile: populationSize === 0 ? 0 : Math.round((((populationSize - index) - 0.5) / populationSize) * 10_000) / 100,
    entity,
    result,
    movement: null,
    movementLabel: 'NEW' as const,
  }));
  const asOf = entries.reduce<string | null>((latest, entry) => {
    if (!entry.result.asOf) return latest;
    return !latest || entry.result.asOf > latest ? entry.result.asOf : latest;
  }, null);

  return {
    rankingType: 'PLAYER_METRIC',
    methodVersion: PLAYER_RANKING_METHOD_VERSION,
    formulaVersion: metric.formulaVersion,
    scopeKey: scopeKey(request),
    request,
    asOf,
    populationSize,
    entries,
  };
}
