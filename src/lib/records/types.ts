import type { AnalyticsCoverageState, AnalyticsEntityType, MetricAggregation, MetricUnit } from '@/lib/analytics';

export const RECORDS_METHOD_VERSION = 'centrepass-records.v1';

export type RecordScope = 'SINGLE_MATCH' | 'EDITION' | 'FINALS' | 'CAREER' | 'TEAM' | 'CENTREPASS_ERA';
export type RecordStatus = 'PROVISIONAL' | 'CONFIRMED' | 'CORRECTED' | 'SUPERSEDED';

export interface RecordEntity {
  id: string;
  name: string;
  slug?: string | null;
  position?: string | null;
  teamName?: string | null;
}

export interface RecordRequest {
  scope: RecordScope;
  metricId: string;
  aggregation: MetricAggregation;
  entityType: AnalyticsEntityType;
  competitionId?: string;
  competitionLabel?: string;
  finalsStageIds?: string[];
  coverageStart: Date;
  limit?: number;
}

export interface RecordCandidate {
  recordType: RecordScope;
  metricId: string;
  entityType: AnalyticsEntityType;
  entity: RecordEntity;
  competitionId: string | null;
  scopeKey: string;
  scope: Record<string, unknown>;
  value: number;
  unit: MetricUnit;
  games: number;
  minutes: number;
  achievedAt: string;
  supportingMatchId: string | null;
  supportingCompetitionId: string | null;
  formulaVersion: string;
  methodVersion: typeof RECORDS_METHOD_VERSION;
  coverage: AnalyticsCoverageState;
  coverageLabel: string;
  includedMatchIds: string[];
  source: { policy: string; note: string };
  status: RecordStatus;
  supersedesId: number | null;
}

export interface StoredRecordEntry extends RecordCandidate {
  id: number;
}

export interface RecordSnapshot {
  methodVersion: typeof RECORDS_METHOD_VERSION;
  request: RecordRequest;
  asOf: string | null;
  coverageLabel: string;
  entries: RecordCandidate[];
}

export interface RecordReconciliation {
  superseded: StoredRecordEntry[];
  inserts: RecordCandidate[];
}

