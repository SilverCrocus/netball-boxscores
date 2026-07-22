import type { AnalyticsCoverageState, AnalyticsEntityType, AnalyticsFact, AnalyticsRawField, MetricAggregation } from '@/lib/analytics';
import { getMetricDefinition } from '@/lib/analytics';
import {
  buildAnalyticsSnapshotCacheKey,
  readAnalyticsCacheEpoch,
} from '@/lib/analytics/cache-epoch';
import {
  listAnalyticsEditions,
  readAnalyticsEntities,
  readAnalyticsPlayerFacts,
  readAnalyticsTeamFacts,
  readFinalsStageIds,
  type AnalyticsEdition,
} from '@/lib/analytics/repository';
import { calculateRecordSnapshot } from '@/lib/records/calculate';
import { RECORDS_METHOD_VERSION, type RecordEntity, type RecordScope } from '@/lib/records/types';
import { recordCacheResult, trackedUnstableCache } from '@/lib/server-timing';

const RECORD_SNAPSHOT_CACHE_NAME = 'analytics_record_snapshot';
const RECORD_EDITIONS_CACHE_NAME = 'analytics_record_editions';
const CACHE_REVALIDATE_SECONDS = 60 * 60;
const CACHE_TAG = 'analytics-snapshots';
const CACHEABLE_IDENTIFIER = /^[^\u0000-\u001f]{1,128}$/u;
const RECORD_SCOPES = new Set<RecordScope>([
  'SINGLE_MATCH',
  'EDITION',
  'FINALS',
  'CAREER',
  'TEAM',
  'CENTREPASS_ERA',
]);

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
    ? (await readAnalyticsPlayerFacts(competitionIds)).map((row): FactRow => ({
      ...row,
      entity_id: row.player_id,
      box_score_coverage: row.player_box_score_coverage,
      goal_differential: null,
      turnover_differential: null,
      shooting_percentage_differential: null,
    }))
    : (await readAnalyticsTeamFacts(competitionIds)).map((row): FactRow => ({
      ...row,
      entity_id: row.team_id,
      position: null,
      box_score_coverage: row.team_box_score_coverage,
      minutes_played: 0,
    }));
  return rows.map((row) => toFact(row, entityType));
}

async function loadEntities(
  entityType: AnalyticsEntityType,
  ids: string[],
  competitionId?: string,
): Promise<RecordEntity[]> {
  return readAnalyticsEntities(entityType, ids, competitionId);
}

export interface RecordSnapshotQuery {
  scope: RecordScope;
  metricId: string;
  aggregation: MetricAggregation;
  entityType: AnalyticsEntityType;
  competitionId?: string;
  limit?: number;
}

export interface RecordSnapshotContext {
  editions: readonly AnalyticsEdition[];
}

interface CachedRecordSnapshotQuery {
  scope: RecordScope;
  metricId: string;
  aggregation: MetricAggregation;
  entityType: AnalyticsEntityType;
  effectiveEntityType: AnalyticsEntityType;
  competitionId: string | null;
  limit: number | null;
}

interface CachedAnalyticsEdition {
  id: string;
  season: number;
  name: string;
  slug: string;
  label: string | null;
  seasonStart: string | null;
  seasonEnd: string | null;
  sourceTimezone: string;
  series: {
    id: string;
    slug: string;
    name: string;
    kind: 'LEAGUE' | 'TOURNAMENT';
  };
}

function cacheableIdentifier(value: unknown, required = false): value is string {
  return typeof value === 'string'
    && (required || value.length > 0)
    && CACHEABLE_IDENTIFIER.test(value);
}

function optionalDateToIso(value: Date | null): string | null | undefined {
  if (value === null) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return undefined;
  return value.toISOString();
}

function normalizeRecordQuery(query: RecordSnapshotQuery): CachedRecordSnapshotQuery | null {
  if (!RECORD_SCOPES.has(query.scope)
    || (query.entityType !== 'PLAYER' && query.entityType !== 'TEAM')
    || !cacheableIdentifier(query.metricId, true)
    || !cacheableIdentifier(query.aggregation, true)
    || (query.competitionId !== undefined && !cacheableIdentifier(query.competitionId, true))
    || (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100))) {
    return null;
  }

  const effectiveEntityType: AnalyticsEntityType = query.scope === 'TEAM' ? 'TEAM' : query.entityType;
  const metric = getMetricDefinition(query.metricId);
  if (!metric
    || metric.calculation.kind === 'SERVICE'
    || !metric.entityTypes.includes(effectiveEntityType)
    || !metric.allowedAggregations.includes(query.aggregation)) {
    return null;
  }

  return {
    scope: query.scope,
    metricId: query.metricId,
    aggregation: query.aggregation,
    entityType: query.entityType,
    effectiveEntityType,
    competitionId: query.competitionId ?? null,
    limit: query.limit ?? null,
  };
}

function normalizeAnalyticsEditions(editions: readonly AnalyticsEdition[]): CachedAnalyticsEdition[] | null {
  if (editions.length > 200) return null;
  const normalized: CachedAnalyticsEdition[] = [];
  for (const edition of editions) {
    if (!cacheableIdentifier(edition.id, true)
      || !Number.isInteger(edition.season)
      || !cacheableIdentifier(edition.name, true)
      || !cacheableIdentifier(edition.slug, true)
      || (edition.label !== null && !cacheableIdentifier(edition.label, true))
      || !cacheableIdentifier(edition.sourceTimezone, true)
      || !cacheableIdentifier(edition.series.id, true)
      || !cacheableIdentifier(edition.series.slug, true)
      || !cacheableIdentifier(edition.series.name, true)
      || (edition.series.kind !== 'LEAGUE' && edition.series.kind !== 'TOURNAMENT')) {
      return null;
    }
    const seasonStart = optionalDateToIso(edition.seasonStart);
    const seasonEnd = optionalDateToIso(edition.seasonEnd);
    if (seasonStart === undefined || seasonEnd === undefined) return null;
    normalized.push({
      id: edition.id,
      season: edition.season,
      name: edition.name,
      slug: edition.slug,
      label: edition.label,
      seasonStart,
      seasonEnd,
      sourceTimezone: edition.sourceTimezone,
      series: { ...edition.series },
    });
  }
  return normalized;
}

function restoreRecordQuery(query: CachedRecordSnapshotQuery): RecordSnapshotQuery {
  return {
    scope: query.scope,
    metricId: query.metricId,
    aggregation: query.aggregation,
    entityType: query.entityType,
    ...(query.competitionId ? { competitionId: query.competitionId } : {}),
    ...(query.limit !== null ? { limit: query.limit } : {}),
  };
}

function restoreAnalyticsEditions(editions: readonly CachedAnalyticsEdition[]): AnalyticsEdition[] {
  return editions.map((edition) => ({
    id: edition.id,
    season: edition.season,
    name: edition.name,
    slug: edition.slug,
    label: edition.label,
    seasonStart: edition.seasonStart ? new Date(edition.seasonStart) : null,
    seasonEnd: edition.seasonEnd ? new Date(edition.seasonEnd) : null,
    sourceTimezone: edition.sourceTimezone,
    series: { ...edition.series },
  }));
}

export async function getRecordSnapshotUncached(
  query: RecordSnapshotQuery,
  context?: RecordSnapshotContext,
) {
  const entityType: AnalyticsEntityType = query.scope === 'TEAM' ? 'TEAM' : query.entityType;
  const editions = context?.editions ?? await listAnalyticsEditions();
  const selectedEdition = editions.find((edition) => edition.id === query.competitionId);
  const isCrossEdition = query.scope === 'CAREER' || query.scope === 'CENTREPASS_ERA';
  const competitionIds = isCrossEdition ? editions.map((edition) => edition.id) : selectedEdition ? [selectedEdition.id] : [];
  const facts = await loadFacts(entityType, competitionIds);
  const entityIds = [...new Set(facts.map((fact) => fact.entityId))];
  const entities = await loadEntities(
    entityType,
    entityIds,
    competitionIds.length === 1 ? competitionIds[0] : undefined,
  );
  const finalsStages = selectedEdition && query.scope === 'FINALS'
    ? await readFinalsStageIds(selectedEdition.id)
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
      ? `${selectedEdition.series.name} · ${selectedEdition.label ?? selectedEdition.season}`
      : undefined,
    finalsStageIds: finalsStages,
    coverageStart,
    limit: query.limit,
  });
}

const cachedAnalyticsEditions = trackedUnstableCache(
  RECORD_EDITIONS_CACHE_NAME,
  async (epoch: string) => {
    void epoch;
    return listAnalyticsEditions();
  },
  ['analytics-record-editions-v1'],
  {
    revalidate: CACHE_REVALIDATE_SECONDS,
    tags: [CACHE_TAG],
  },
);

const cachedRecordSnapshot = trackedUnstableCache(
  RECORD_SNAPSHOT_CACHE_NAME,
  async (
    _cacheKey: string,
    query: CachedRecordSnapshotQuery,
    editions: CachedAnalyticsEdition[],
  ) => getRecordSnapshotUncached(
    restoreRecordQuery(query),
    { editions: restoreAnalyticsEditions(editions) },
  ),
  ['analytics-record-snapshot-v1'],
  {
    revalidate: CACHE_REVALIDATE_SECONDS,
    tags: [CACHE_TAG],
  },
);

export async function getRecordSnapshot(
  query: RecordSnapshotQuery,
  context?: RecordSnapshotContext,
) {
  const epoch = await readAnalyticsCacheEpoch();
  const normalizedQuery = epoch ? normalizeRecordQuery(query) : null;
  if (!epoch || !normalizedQuery) {
    recordCacheResult(RECORD_SNAPSHOT_CACHE_NAME, 'miss');
    return getRecordSnapshotUncached(query, context);
  }

  const editions = context?.editions ?? await cachedAnalyticsEditions(epoch);
  const normalizedEditions = normalizeAnalyticsEditions(editions);
  const metric = getMetricDefinition(normalizedQuery.metricId);
  const cacheKey = normalizedEditions && metric
    ? buildAnalyticsSnapshotCacheKey('record', epoch, {
      methodVersion: RECORDS_METHOD_VERSION,
      formulaVersion: metric.formulaVersion,
      query: normalizedQuery,
      orderedPublishedEditionIdentity: normalizedEditions,
    })
    : null;

  if (!cacheKey || !normalizedEditions) {
    recordCacheResult(RECORD_SNAPSHOT_CACHE_NAME, 'miss');
    return getRecordSnapshotUncached(query, context ?? { editions });
  }

  return cachedRecordSnapshot(cacheKey, normalizedQuery, normalizedEditions);
}
