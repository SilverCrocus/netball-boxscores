import { getMetricDefinition } from '@/lib/analytics/catalogue';
import { QUERY_SPEC_VERSION } from '@/lib/stat-query/types';
import type { QuerySpecV1 } from '@/lib/stat-query/types';

export const STAT_QUERY_LIMITS = {
  questionLength: 300,
  comparisonEntities: 2,
  metrics: 5,
  lastN: 100,
  rows: 100,
  minimumMinutes: 10_000,
  timeoutMs: 2_000,
} as const;

const UNSAFE_PATTERNS = [
  /ignore (all|any|the|previous) instructions/i,
  /\b(drop|delete|truncate|insert|alter|grant|revoke)\b/i,
  /\bselect\s+\*/i,
  /--|\/\*|;\s*\w/i,
  /database credentials|service[_ -]?role|api key/i,
  /\b(copy|call|execute|prepare|vacuum|analyze|comment|create)\b/i,
  /\b(pg_catalog|information_schema|analytics\.|public\.)\b/i,
];

const CANONICAL_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const POSITIONS = new Set(['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK']);
const RECORD_SCOPES = new Set(['SINGLE_MATCH', 'EDITION', 'FINALS', 'CAREER', 'TEAM', 'CENTREPASS_ERA']);

export function inputPolicyError(question: string): string | null {
  if (question.trim().length < 2) return 'Question must contain at least two characters.';
  if (question.length > STAT_QUERY_LIMITS.questionLength) return `Question is limited to ${STAT_QUERY_LIMITS.questionLength} characters.`;
  if (/[^\P{C}\t\n\r]/u.test(question)) return 'Question contains unsupported control characters.';
  if (UNSAFE_PATTERNS.some((pattern) => pattern.test(question))) return 'That request contains unsupported instructions rather than a statistical question.';
  return null;
}

export function validateQuerySpec(spec: QuerySpecV1): QuerySpecV1 {
  if (spec.version !== QUERY_SPEC_VERSION) throw new Error('Unsupported query specification version');
  if (!['LOOKUP', 'LEADERBOARD', 'COMPARISON', 'RECORD'].includes(spec.intent)) throw new Error('Unsupported query intent');
  if (!['PLAYER', 'TEAM'].includes(spec.subject)) throw new Error('Unsupported query subject');
  if (!['ENTITY', 'MATCH', 'NONE'].includes(spec.groupBy)) throw new Error('Unsupported query grouping');
  if (!['ASC', 'DESC'].includes(spec.order)) throw new Error('Unsupported query ordering');
  if (!['EDITION', 'LAST_N', 'DATE_RANGE'].includes(spec.window.type)) throw new Error('Unsupported query window');
  if (spec.entityIds.length > STAT_QUERY_LIMITS.comparisonEntities) throw new Error('At most two entities may be compared');
  if (spec.entityIds.some((id) => !CANONICAL_ID.test(id))) throw new Error('Entity ID is invalid');
  if (spec.metrics.length < 1 || spec.metrics.length > STAT_QUERY_LIMITS.metrics) throw new Error('Between one and five metrics are required');
  for (const metric of spec.metrics) {
    const definition = getMetricDefinition(metric.id);
    if (!definition) throw new Error('Metric is not allowlisted');
    if (!definition.entityTypes.includes(spec.subject)) throw new Error('Metric does not support this subject');
    if (!definition.allowedAggregations.includes(metric.aggregation)) throw new Error('Metric aggregation is not allowlisted');
  }
  if (spec.window.lastN !== undefined && (!Number.isInteger(spec.window.lastN) || spec.window.lastN < 1 || spec.window.lastN > STAT_QUERY_LIMITS.lastN)) throw new Error('lastN is outside the allowed range');
  if (spec.window.type === 'EDITION' && (spec.window.lastN !== undefined || spec.window.from !== undefined || spec.window.to !== undefined)) throw new Error('Edition window contains unsupported bounds');
  if (spec.window.type === 'LAST_N' && (spec.window.lastN === undefined || spec.window.from !== undefined || spec.window.to !== undefined)) throw new Error('Last-N window is incomplete');
  if (spec.window.type === 'DATE_RANGE') {
    if (spec.window.lastN !== undefined || spec.window.from === undefined || spec.window.to === undefined) throw new Error('Date range is incomplete');
    const from = new Date(spec.window.from ?? '');
    const to = new Date(spec.window.to ?? '');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new Error('Date range is invalid');
    if (to.getTime() - from.getTime() > 10 * 366 * 24 * 60 * 60 * 1000) throw new Error('Date range exceeds ten years');
  }
  if (!Number.isInteger(spec.limit) || spec.limit < 1 || spec.limit > STAT_QUERY_LIMITS.rows) throw new Error('Result limit is outside the allowed range');
  if (!Number.isInteger(spec.minimumMinutes) || spec.minimumMinutes < 0 || spec.minimumMinutes > STAT_QUERY_LIMITS.minimumMinutes) throw new Error('Minimum minutes is outside the allowed range');
  if (!CANONICAL_ID.test(spec.filters.editionId)) throw new Error('An edition ID is required');
  for (const scopedId of [spec.filters.stageId, spec.filters.stageGroupId, spec.filters.opponentId]) {
    if (scopedId !== undefined && !CANONICAL_ID.test(scopedId)) throw new Error('Scope ID is invalid');
  }
  if (spec.filters.position !== undefined && !POSITIONS.has(spec.filters.position)) throw new Error('Position is invalid');
  if (!spec.filters.officialCompletedOnly || !spec.filters.excludeSimulations) throw new Error('Public stat queries must use official non-simulation results');
  if (spec.intent === 'COMPARISON' && spec.entityIds.length !== 2) throw new Error('Comparison requires exactly two entities');
  if (spec.intent === 'LOOKUP' && spec.entityIds.length !== 1) throw new Error('Lookup requires exactly one entity');
  if (spec.intent === 'LEADERBOARD' && spec.entityIds.length !== 0) throw new Error('Leaderboard cannot target a specific entity');
  if (spec.subject === 'TEAM' && spec.intent === 'COMPARISON') throw new Error('Team comparison is not supported');
  if (spec.subject === 'TEAM' && (
    spec.window.type !== 'EDITION'
    || spec.filters.stageId !== undefined
    || spec.filters.stageGroupId !== undefined
    || spec.filters.opponentId !== undefined
    || spec.filters.position !== undefined
  )) throw new Error('Scoped team queries are not supported');
  if (spec.intent === 'COMPARISON' && (
    spec.window.type === 'DATE_RANGE'
    || spec.filters.stageId !== undefined
    || spec.filters.stageGroupId !== undefined
    || spec.filters.opponentId !== undefined
  )) throw new Error('Comparison scope is not supported');
  if (spec.intent === 'RECORD' && (
    spec.window.type !== 'EDITION'
    || spec.filters.stageId !== undefined
    || spec.filters.stageGroupId !== undefined
    || spec.filters.opponentId !== undefined
  )) throw new Error('Record scope filters are not supported');
  if (spec.filters.position !== undefined && (spec.subject !== 'PLAYER' || spec.intent !== 'LEADERBOARD')) throw new Error('Position is supported only for player leaderboards');
  if (spec.minimumMinutes !== 0 && (spec.subject !== 'PLAYER' || spec.intent !== 'LEADERBOARD')) throw new Error('Minimum minutes is supported only for player leaderboards');
  if (spec.intent === 'LOOKUP' && (spec.groupBy !== 'NONE' || spec.limit !== 1)) throw new Error('Lookup shape is invalid');
  if (spec.intent === 'LEADERBOARD' && spec.groupBy !== 'ENTITY') throw new Error('Leaderboard grouping is invalid');
  if (spec.intent === 'COMPARISON' && (spec.groupBy !== 'ENTITY' || spec.limit !== 2)) throw new Error('Comparison shape is invalid');
  if (spec.intent === 'RECORD') {
    if (!spec.recordScope || !RECORD_SCOPES.has(spec.recordScope)) throw new Error('Record scope is invalid');
    const expectedGrouping = spec.recordScope === 'SINGLE_MATCH' ? 'MATCH' : 'ENTITY';
    if (spec.groupBy !== expectedGrouping) throw new Error('Record grouping is invalid');
  } else if (spec.recordScope !== undefined) {
    throw new Error('Record scope is valid only for record queries');
  }
  return spec;
}
