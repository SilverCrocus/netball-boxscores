import type { AnalyticsCoverageState, MetricAggregation, MetricResult } from '@/lib/analytics';

export const PLAYER_RANKING_METHOD_VERSION = 'centrepass-player-ranking.v1';
export const TEAM_POWER_METHOD_VERSION = 'centrepass-team-power.v1';

export interface RankingEntity {
  id: string;
  name: string;
  slug?: string | null;
  abbreviation?: string | null;
  position?: string | null;
  teamName?: string | null;
}

export interface PlayerRankingRequest {
  competitionId: string;
  metricId: string;
  aggregation: MetricAggregation;
  position?: string;
  stageId?: string;
  stageGroupId?: string;
  lastN?: number;
  from?: Date;
  to?: Date;
  minimumMinutes: number;
}

export interface PlayerRankingEntry {
  rank: number;
  percentile: number;
  entity: RankingEntity;
  result: MetricResult;
  movement: number | null;
  movementLabel: 'NEW' | 'UP' | 'DOWN' | 'SAME';
}

export interface PlayerRankingSnapshot {
  rankingType: 'PLAYER_METRIC';
  methodVersion: typeof PLAYER_RANKING_METHOD_VERSION;
  formulaVersion: string;
  scopeKey: string;
  request: PlayerRankingRequest;
  asOf: string | null;
  populationSize: number;
  entries: PlayerRankingEntry[];
}

export interface TeamPowerMatch {
  id: string;
  competitionId: string;
  competitionSeriesId: string;
  competitionKind: 'LEAGUE' | 'TOURNAMENT';
  scheduledAt: Date;
  sourceUpdatedAt?: Date | null;
  neutralVenue: boolean;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
}

export interface TeamPowerEntry {
  rank: number;
  percentile: number;
  entity: RankingEntity;
  rating: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  coverage: AnalyticsCoverageState;
  includedMatchIds: string[];
  movement: number | null;
  movementLabel: 'NEW' | 'UP' | 'DOWN' | 'SAME';
}

export interface TeamPowerSnapshot {
  rankingType: 'TEAM_POWER';
  methodVersion: typeof TEAM_POWER_METHOD_VERSION;
  formulaVersion: typeof TEAM_POWER_METHOD_VERSION;
  competitionId: string;
  competitionSeriesId: string | null;
  competitionKind: 'LEAGUE' | 'TOURNAMENT' | null;
  scopeKey: string;
  asOf: string | null;
  populationSize: number;
  entries: TeamPowerEntry[];
}
