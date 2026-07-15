export type AnalyticsEntityType = 'PLAYER' | 'TEAM';

export type MetricAggregation =
  | 'TOTAL'
  | 'PER_GAME'
  | 'PER_60'
  | 'WEIGHTED_PERCENTAGE';

export type MetricUnit = 'COUNT' | 'PERCENT' | 'POINTS' | 'RATING';

export type AnalyticsCoverageState =
  | 'AVAILABLE'
  | 'PARTIAL'
  | 'PROVISIONAL'
  | 'UNAVAILABLE';

export type AnalyticsResultStatus =
  | 'AVAILABLE'
  | 'UNAVAILABLE'
  | 'INSUFFICIENT_SAMPLE';

export type AnalyticsCapability =
  | 'TEAM_BOX_SCORE'
  | 'PLAYER_BOX_SCORE'
  | 'NET_POINTS'
  | 'SUPER_SHOTS';

export type AnalyticsRawField =
  | 'goals'
  | 'attempts'
  | 'goalAssists'
  | 'intercepts'
  | 'deflections'
  | 'rebounds'
  | 'penalties'
  | 'feeds'
  | 'centrePassReceives'
  | 'turnovers'
  | 'gain'
  | 'pickups'
  | 'netPoints'
  | 'minutesPlayed';

export interface MetricMinimumSample {
  games?: number;
  minutes?: number;
  attempts?: number;
}

export interface MetricDefinition {
  id: string;
  aliases: readonly string[];
  displayName: string;
  definition: string;
  entityTypes: readonly AnalyticsEntityType[];
  unit: MetricUnit;
  allowedAggregations: readonly MetricAggregation[];
  defaultAggregation: MetricAggregation;
  requiredFields: readonly AnalyticsRawField[];
  requiredCapabilities: Partial<Record<AnalyticsEntityType, readonly AnalyticsCapability[]>>;
  compatiblePositions: 'ALL' | readonly string[];
  minimumSample: Partial<Record<MetricAggregation, MetricMinimumSample>>;
  higherIsBetter: boolean;
  formulaVersion: string;
  calculation:
    | { kind: 'SUM'; field: AnalyticsRawField }
    | { kind: 'WEIGHTED_PERCENTAGE'; numerator: AnalyticsRawField; denominator: AnalyticsRawField };
}

export interface AnalyticsFact {
  entityType: AnalyticsEntityType;
  entityId: string;
  matchId: string;
  competitionId: string;
  competitionSeriesId: string;
  competitionKind: 'LEAGUE' | 'TOURNAMENT';
  stageId?: string | null;
  stageGroupId?: string | null;
  position?: string | null;
  scheduledAt: Date;
  sourceUpdatedAt?: Date | null;
  status: string;
  resultQuality: string;
  isSimulation: boolean;
  capabilities: Partial<Record<AnalyticsCapability, AnalyticsCoverageState>>;
  stats: Partial<Record<AnalyticsRawField, number | null>>;
}

export interface MetricWindow {
  lastN?: number;
  from?: Date;
  to?: Date;
}

export interface MetricQueryContext {
  entityType: AnalyticsEntityType;
  entityId: string;
  competitionId: string;
  stageId?: string;
  stageGroupId?: string;
  window?: MetricWindow;
}

export interface MetricResult {
  metricId: string;
  value: number | null;
  status: AnalyticsResultStatus;
  unit: MetricUnit;
  aggregation: MetricAggregation;
  context: MetricQueryContext;
  games: number;
  minutes: number;
  minimumSample: MetricMinimumSample;
  minimumSampleMet: boolean;
  coverage: AnalyticsCoverageState;
  formulaVersion: string;
  asOf: string | null;
  includedMatchIds: string[];
}
