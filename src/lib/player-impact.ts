import type { AnalyticsCoverageState, AnalyticsFact } from '@/lib/analytics';

export const CENTREPASS_IMPACT_VERSION = 'centrepass-impact.v1';
export const CENTREPASS_IMPACT_MINIMUM_MINUTES = 30;
const SHRINKAGE_MINUTES = 120;

export type ImpactPositionGroup = 'SHOOTER' | 'MIDCOURT' | 'DEFENDER';

export interface CentrePassImpactResult {
  metricId: 'centrepass_impact';
  value: number | null;
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'INSUFFICIENT_SAMPLE';
  percentile: number | null;
  positionGroup: ImpactPositionGroup;
  populationSize: number;
  games: number;
  minutes: number;
  shrinkage: number;
  coverage: AnalyticsCoverageState;
  formulaVersion: typeof CENTREPASS_IMPACT_VERSION;
  includedMatchIds: string[];
  asOf: string | null;
}

interface FeatureDefinition {
  key: string;
  weight: number;
  value: (summary: PlayerSummary) => number;
}

interface PlayerSummary {
  playerId: string;
  games: number;
  minutes: number;
  matchIds: string[];
  asOf: Date | null;
  coverage: AnalyticsCoverageState;
  totals: Record<string, number>;
}

const POSITIVE_COVERAGE = new Set<AnalyticsCoverageState>(['AVAILABLE', 'PARTIAL']);

export function impactPositionGroup(position: string): ImpactPositionGroup {
  if (position === 'GS' || position === 'GA') return 'SHOOTER';
  if (position === 'GD' || position === 'GK') return 'DEFENDER';
  return 'MIDCOURT';
}

function per60(summary: PlayerSummary, field: string): number {
  return summary.minutes > 0 ? ((summary.totals[field] ?? 0) / summary.minutes) * 60 : 0;
}

function accuracy(summary: PlayerSummary): number {
  const attempts = summary.totals.attempts ?? 0;
  return attempts > 0 ? ((summary.totals.goals ?? 0) / attempts) * 100 : 0;
}

function featureDefinitions(group: ImpactPositionGroup): FeatureDefinition[] {
  if (group === 'SHOOTER') {
    return [
      { key: 'goals_per_60', weight: 0.32, value: (summary) => per60(summary, 'goals') },
      { key: 'goal_accuracy', weight: 0.2, value: accuracy },
      { key: 'attacking_per_60', weight: 0.18, value: (summary) => per60(summary, 'goalAssists') + per60(summary, 'feeds') },
      { key: 'rebounds_per_60', weight: 0.08, value: (summary) => per60(summary, 'rebounds') },
      { key: 'gains_per_60', weight: 0.07, value: (summary) => per60(summary, 'gain') },
      { key: 'turnovers_per_60', weight: -0.1, value: (summary) => per60(summary, 'turnovers') },
      { key: 'penalties_per_60', weight: -0.05, value: (summary) => per60(summary, 'penalties') },
    ];
  }
  if (group === 'DEFENDER') {
    return [
      { key: 'defensive_per_60', weight: 0.35, value: (summary) => per60(summary, 'gain') + per60(summary, 'deflections') },
      { key: 'intercepts_per_60', weight: 0.2, value: (summary) => per60(summary, 'intercepts') },
      { key: 'rebounds_per_60', weight: 0.12, value: (summary) => per60(summary, 'rebounds') },
      { key: 'pickups_per_60', weight: 0.1, value: (summary) => per60(summary, 'pickups') },
      { key: 'attacking_per_60', weight: 0.08, value: (summary) => per60(summary, 'goalAssists') + per60(summary, 'feeds') },
      { key: 'turnovers_per_60', weight: -0.05, value: (summary) => per60(summary, 'turnovers') },
      { key: 'penalties_per_60', weight: -0.1, value: (summary) => per60(summary, 'penalties') },
    ];
  }
  return [
    { key: 'goal_assists_per_60', weight: 0.22, value: (summary) => per60(summary, 'goalAssists') },
    { key: 'feeds_per_60', weight: 0.2, value: (summary) => per60(summary, 'feeds') },
    { key: 'cpr_per_60', weight: 0.14, value: (summary) => per60(summary, 'centrePassReceives') },
    { key: 'gains_per_60', weight: 0.14, value: (summary) => per60(summary, 'gain') },
    { key: 'intercepts_per_60', weight: 0.1, value: (summary) => per60(summary, 'intercepts') },
    { key: 'pickups_per_60', weight: 0.05, value: (summary) => per60(summary, 'pickups') },
    { key: 'turnovers_per_60', weight: -0.1, value: (summary) => per60(summary, 'turnovers') },
    { key: 'penalties_per_60', weight: -0.05, value: (summary) => per60(summary, 'penalties') },
  ];
}

function summarize(facts: readonly AnalyticsFact[]): PlayerSummary[] {
  const summaries = new Map<string, PlayerSummary>();
  for (const fact of facts) {
    if (
      fact.entityType !== 'PLAYER'
      || fact.status !== 'COMPLETED'
      || !['OFFICIAL_FINAL', 'CORRECTED'].includes(fact.resultQuality)
      || fact.isSimulation
      || !POSITIVE_COVERAGE.has(fact.capabilities.PLAYER_BOX_SCORE ?? 'UNAVAILABLE')
    ) continue;

    const summary = summaries.get(fact.entityId) ?? {
      playerId: fact.entityId,
      games: 0,
      minutes: 0,
      matchIds: [],
      asOf: null,
      coverage: 'AVAILABLE' as AnalyticsCoverageState,
      totals: {},
    };
    summary.games += 1;
    summary.minutes += fact.stats.minutesPlayed ?? 0;
    summary.matchIds.push(fact.matchId);
    const factAsOf = fact.sourceUpdatedAt ?? fact.scheduledAt;
    if (!summary.asOf || factAsOf > summary.asOf) summary.asOf = factAsOf;
    if (fact.capabilities.PLAYER_BOX_SCORE === 'PARTIAL') summary.coverage = 'PARTIAL';
    for (const [field, value] of Object.entries(fact.stats)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        summary.totals[field] = (summary.totals[field] ?? 0) + value;
      }
    }
    summaries.set(fact.entityId, summary);
  }
  return [...summaries.values()];
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateCentrePassImpact(
  facts: readonly AnalyticsFact[],
  playerId: string,
  competitionId: string,
  position: string,
): CentrePassImpactResult {
  const group = impactPositionGroup(position);
  const compatibleFacts = facts.filter((fact) =>
    fact.competitionId === competitionId && impactPositionGroup(fact.position ?? '') === group,
  );
  const population = summarize(compatibleFacts);
  const target = population.find((summary) => summary.playerId === playerId);
  const empty: CentrePassImpactResult = {
    metricId: 'centrepass_impact',
    value: null,
    status: 'UNAVAILABLE',
    percentile: null,
    positionGroup: group,
    populationSize: population.length,
    games: 0,
    minutes: 0,
    shrinkage: 0,
    coverage: 'UNAVAILABLE',
    formulaVersion: CENTREPASS_IMPACT_VERSION,
    includedMatchIds: [],
    asOf: null,
  };
  if (!target) return empty;

  const features = featureDefinitions(group);
  const distributions = new Map(features.map((feature) => {
    const values = population.map(feature.value);
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / Math.max(values.length, 1);
    return [feature.key, { mean, deviation: Math.sqrt(variance) }];
  }));

  const ratings = population.map((summary) => {
    const standardized = features.reduce((score, feature) => {
      const distribution = distributions.get(feature.key)!;
      const zScore = distribution.deviation > 0
        ? (feature.value(summary) - distribution.mean) / distribution.deviation
        : 0;
      return score + (zScore * feature.weight);
    }, 0);
    const unshrunk = 50 + (standardized * 10);
    const shrinkage = summary.minutes / (summary.minutes + SHRINKAGE_MINUTES);
    const rating = Math.min(100, Math.max(0, 50 + ((unshrunk - 50) * shrinkage)));
    return { playerId: summary.playerId, rating, shrinkage };
  });
  const targetRating = ratings.find((rating) => rating.playerId === playerId)!;
  const below = ratings.filter((rating) => rating.rating < targetRating.rating).length;
  const equal = ratings.filter((rating) => rating.rating === targetRating.rating).length;
  const percentile = ((below + (equal * 0.5)) / Math.max(ratings.length, 1)) * 100;
  const sampleMet = target.minutes >= CENTREPASS_IMPACT_MINIMUM_MINUTES;

  return {
    metricId: 'centrepass_impact',
    value: sampleMet ? round(targetRating.rating) : null,
    status: sampleMet ? 'AVAILABLE' : 'INSUFFICIENT_SAMPLE',
    percentile: sampleMet ? round(percentile) : null,
    positionGroup: group,
    populationSize: population.length,
    games: target.games,
    minutes: round(target.minutes),
    shrinkage: round(targetRating.shrinkage),
    coverage: target.coverage,
    formulaVersion: CENTREPASS_IMPACT_VERSION,
    includedMatchIds: target.matchIds,
    asOf: target.asOf?.toISOString() ?? null,
  };
}
