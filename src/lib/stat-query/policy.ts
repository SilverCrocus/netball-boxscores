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
];

export function inputPolicyError(question: string): string | null {
  if (question.trim().length < 2) return 'Question must contain at least two characters.';
  if (question.length > STAT_QUERY_LIMITS.questionLength) return `Question is limited to ${STAT_QUERY_LIMITS.questionLength} characters.`;
  if (UNSAFE_PATTERNS.some((pattern) => pattern.test(question))) return 'That request contains unsupported instructions rather than a statistical question.';
  return null;
}

export function validateQuerySpec(spec: QuerySpecV1): QuerySpecV1 {
  if (spec.entityIds.length > STAT_QUERY_LIMITS.comparisonEntities) throw new Error('At most two entities may be compared');
  if (spec.metrics.length < 1 || spec.metrics.length > STAT_QUERY_LIMITS.metrics) throw new Error('Between one and five metrics are required');
  if (spec.window.lastN !== undefined && (!Number.isInteger(spec.window.lastN) || spec.window.lastN < 1 || spec.window.lastN > STAT_QUERY_LIMITS.lastN)) throw new Error('lastN is outside the allowed range');
  if (spec.window.type === 'DATE_RANGE') {
    const from = new Date(spec.window.from ?? '');
    const to = new Date(spec.window.to ?? '');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new Error('Date range is invalid');
    if (to.getTime() - from.getTime() > 10 * 366 * 24 * 60 * 60 * 1000) throw new Error('Date range exceeds ten years');
  }
  if (!Number.isInteger(spec.limit) || spec.limit < 1 || spec.limit > STAT_QUERY_LIMITS.rows) throw new Error('Result limit is outside the allowed range');
  if (!Number.isFinite(spec.minimumMinutes) || spec.minimumMinutes < 0 || spec.minimumMinutes > STAT_QUERY_LIMITS.minimumMinutes) throw new Error('Minimum minutes is outside the allowed range');
  if (!spec.filters.editionId) throw new Error('An edition ID is required');
  if (!spec.filters.officialCompletedOnly || !spec.filters.excludeSimulations) throw new Error('Public stat queries must use official non-simulation results');
  if (spec.intent === 'COMPARISON' && spec.entityIds.length !== 2) throw new Error('Comparison requires exactly two entities');
  return spec;
}
