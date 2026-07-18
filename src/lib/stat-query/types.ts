import type { AnalyticsEntityType, MetricAggregation } from '@/lib/analytics';
import type { RecordScope } from '@/lib/records';

export const QUERY_SPEC_VERSION = 'query-spec.v1' as const;
export const RULE_PARSER_VERSION = 'centrepass-rules.v1' as const;

export type QueryIntent = 'LOOKUP' | 'LEADERBOARD' | 'COMPARISON' | 'RECORD';

export interface QueryMetricSpec {
  id: string;
  aggregation: MetricAggregation;
}

export interface QueryWindowSpec {
  type: 'EDITION' | 'LAST_N' | 'DATE_RANGE';
  lastN?: number;
  from?: string;
  to?: string;
}

export interface QuerySpecV1 {
  version: typeof QUERY_SPEC_VERSION;
  intent: QueryIntent;
  subject: AnalyticsEntityType;
  entityIds: string[];
  metrics: QueryMetricSpec[];
  filters: {
    editionId: string;
    stageId?: string;
    stageGroupId?: string;
    opponentId?: string;
    position?: string;
    officialCompletedOnly: true;
    excludeSimulations: true;
  };
  window: QueryWindowSpec;
  groupBy: 'ENTITY' | 'MATCH' | 'NONE';
  order: 'ASC' | 'DESC';
  minimumMinutes: number;
  limit: number;
  recordScope?: RecordScope;
}

export type ClarificationReason = 'ENTITY_MISSING' | 'ENTITY_AMBIGUOUS' | 'METRIC_MISSING' | 'METRIC_AMBIGUOUS' | 'EDITION_MISSING' | 'COMPARISON_NEEDS_TWO_PLAYERS';

export type ParseResult =
  | { status: 'READY'; spec: QuerySpecV1; interpretation: string; parserVersion: typeof RULE_PARSER_VERSION }
  | { status: 'NEEDS_CLARIFICATION'; reason: ClarificationReason; question: string; options: Array<{ id: string; label: string }>; parserVersion: typeof RULE_PARSER_VERSION }
  | { status: 'UNSUPPORTED'; code: string; message: string; parserVersion: typeof RULE_PARSER_VERSION };

export interface EntityCandidate {
  id: string;
  kind: AnalyticsEntityType;
  name: string;
  aliases: string[];
  position?: string | null;
}

export interface EditionCandidate {
  id: string;
  name: string;
  aliases: string[];
}

export interface ScopeCandidate {
  id: string;
  competitionId: string;
  name: string;
  aliases: string[];
}

export interface ParserContext {
  entities: EntityCandidate[];
  editions: EditionCandidate[];
  stages?: ScopeCandidate[];
  groups?: ScopeCandidate[];
  defaultEditionId?: string;
}

export interface StatQueryResponse {
  status: 'READY' | 'NEEDS_CLARIFICATION' | 'UNSUPPORTED' | 'ERROR';
  question: string;
  interpretation?: string;
  spec?: QuerySpecV1;
  answer?: string;
  result?: unknown;
  clarification?: { reason: ClarificationReason; question: string; options: Array<{ id: string; label: string }> };
  error?: { code: string; message: string; retryable: boolean };
  audit: { parserVersion: string; latencyMs: number; cache: 'HIT' | 'MISS'; asOf?: string | null };
}
