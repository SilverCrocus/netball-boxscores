import type { AnalyticsCoverageState, MetricAggregation, MetricResult } from '@/lib/analytics';

export const PLAYER_COMPARISON_VERSION = 'centrepass-player-comparison.v1';

export interface ComparisonPlayer {
  id: string;
  name: string;
  position: string;
  teamName: string;
}

export interface PlayerComparisonRequest {
  leftPlayerId: string;
  rightPlayerId: string;
  leftCompetitionId: string;
  rightCompetitionId: string;
  aggregation: MetricAggregation;
  metricIds: string[];
  lastN?: number;
}

export interface ComparisonValue {
  result: MetricResult;
  positionPercentile: number | null;
}

export interface ComparisonMetric {
  metricId: string;
  displayName: string;
  definition: string;
  formulaVersion: string;
  left: ComparisonValue;
  right: ComparisonValue;
}

export interface RejectedComparisonMetric {
  metricId: string;
  reason: 'UNSUPPORTED_MODE' | 'UNAVAILABLE_FOR_BOTH' | 'INCOMPATIBLE_COVERAGE' | 'INCOMPATIBLE_FORMULA';
}

export interface PlayerComparisonSnapshot {
  version: typeof PLAYER_COMPARISON_VERSION;
  request: PlayerComparisonRequest;
  leftPlayer: ComparisonPlayer;
  rightPlayer: ComparisonPlayer;
  crossPosition: boolean;
  leadWithPercentiles: boolean;
  metrics: ComparisonMetric[];
  rejectedMetrics: RejectedComparisonMetric[];
  warnings: string[];
  coverage: { left: AnalyticsCoverageState; right: AnalyticsCoverageState };
  asOf: string | null;
}

