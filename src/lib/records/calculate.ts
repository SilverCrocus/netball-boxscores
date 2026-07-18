import { calculateMetric, getMetricDefinition } from '@/lib/analytics';
import type { AnalyticsFact } from '@/lib/analytics';
import { RECORDS_METHOD_VERSION, type RecordCandidate, type RecordEntity, type RecordRequest, type RecordSnapshot } from '@/lib/records/types';

const OFFICIAL_POLICY = 'completed + official-final/corrected + non-simulation + declared coverage';

function coverageLabel(request: RecordRequest): string {
  if (request.scope === 'EDITION' || request.scope === 'FINALS' || request.scope === 'SINGLE_MATCH' || request.scope === 'TEAM') {
    return `Highest recorded by CentrePass in ${request.competitionLabel ?? 'this edition'}`;
  }
  return `Highest recorded by CentrePass since ${request.coverageStart.toISOString().slice(0, 10)}`;
}

function scopeKey(request: RecordRequest): string {
  return [
    `scope:${request.scope}`,
    `entity:${request.entityType}`,
    `competition:${request.competitionId ?? 'ALL_COVERED'}`,
    `metric:${request.metricId}`,
    `aggregation:${request.aggregation}`,
    request.scope === 'FINALS' ? `stages:${(request.finalsStageIds ?? []).toSorted().join(',')}` : null,
  ].filter(Boolean).join('|');
}

function normalizeCrossEditionFacts(facts: readonly AnalyticsFact[], syntheticCompetitionId: string): AnalyticsFact[] {
  return facts.map((fact) => ({ ...fact, competitionId: syntheticCompetitionId }));
}

function candidateFromResult(
  request: RecordRequest,
  entity: RecordEntity,
  result: ReturnType<typeof calculateMetric>,
  supportingMatchId: string | null,
): RecordCandidate | null {
  if (result.status !== 'AVAILABLE' || result.value === null || !result.asOf) return null;
  return {
    recordType: request.scope,
    metricId: request.metricId,
    entityType: request.entityType,
    entity,
    competitionId: request.competitionId ?? null,
    scopeKey: scopeKey(request),
    scope: {
      scope: request.scope,
      aggregation: request.aggregation,
      competitionId: request.competitionId ?? null,
      finalsStageIds: request.finalsStageIds ?? [],
      coverageStart: request.coverageStart.toISOString(),
    },
    value: result.value,
    unit: result.unit,
    games: result.games,
    minutes: result.minutes,
    achievedAt: result.asOf,
    supportingMatchId,
    supportingCompetitionId: request.competitionId ?? null,
    formulaVersion: result.formulaVersion,
    methodVersion: RECORDS_METHOD_VERSION,
    coverage: result.coverage,
    coverageLabel: coverageLabel(request),
    includedMatchIds: result.includedMatchIds,
    source: { policy: OFFICIAL_POLICY, note: 'Derived from the registered CentrePass metric catalogue.' },
    status: 'CONFIRMED',
    supersedesId: null,
  };
}

export function calculateRecordSnapshot(
  facts: readonly AnalyticsFact[],
  entities: readonly RecordEntity[],
  request: RecordRequest,
): RecordSnapshot {
  const metric = getMetricDefinition(request.metricId);
  if (!metric || !metric.entityTypes.includes(request.entityType) || metric.calculation.kind === 'SERVICE') {
    throw new Error(`Unsupported record metric: ${request.metricId}`);
  }
  if (!metric.allowedAggregations.includes(request.aggregation)) {
    throw new Error(`${request.aggregation} is not supported for ${request.metricId}`);
  }
  const limit = request.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Record limit must be between 1 and 100');

  let selected = facts.filter((fact) => fact.entityType === request.entityType && fact.scheduledAt >= request.coverageStart);
  if (request.competitionId) selected = selected.filter((fact) => fact.competitionId === request.competitionId);
  if (request.scope === 'FINALS') {
    const stageIds = new Set(request.finalsStageIds ?? []);
    selected = selected.filter((fact) => fact.stageId && stageIds.has(fact.stageId));
  }
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const candidates: RecordCandidate[] = [];

  if (request.scope === 'SINGLE_MATCH') {
    for (const fact of selected) {
      const entity = entityById.get(fact.entityId);
      if (!entity) continue;
      const result = calculateMetric(request.metricId, [fact], {
        entityType: request.entityType,
        entityId: fact.entityId,
        competitionId: fact.competitionId,
      }, request.aggregation);
      const candidate = candidateFromResult(request, entity, result, fact.matchId);
      if (candidate) candidates.push(candidate);
    }
  } else {
    const syntheticCompetitionId = request.competitionId ?? `records:${request.scope}`;
    const normalized = request.competitionId ? selected : normalizeCrossEditionFacts(selected, syntheticCompetitionId);
    for (const entity of entities) {
      const result = calculateMetric(request.metricId, normalized, {
        entityType: request.entityType,
        entityId: entity.id,
        competitionId: syntheticCompetitionId,
      }, request.aggregation);
      const candidate = candidateFromResult(request, entity, result, null);
      if (candidate) candidates.push(candidate);
    }
  }

  candidates.sort((left, right) => {
    const valueDifference = metric.higherIsBetter ? right.value - left.value : left.value - right.value;
    return valueDifference || left.entity.name.localeCompare(right.entity.name) || left.achievedAt.localeCompare(right.achievedAt);
  });
  const entries = candidates.slice(0, limit);
  const asOfDate = selected.reduce<Date | null>((latest, fact) => {
    const candidate = fact.sourceUpdatedAt ?? fact.scheduledAt;
    return !latest || candidate > latest ? candidate : latest;
  }, null);
  const asOf = asOfDate?.toISOString() ?? null;
  return { methodVersion: RECORDS_METHOD_VERSION, request, asOf, coverageLabel: coverageLabel(request), entries };
}
