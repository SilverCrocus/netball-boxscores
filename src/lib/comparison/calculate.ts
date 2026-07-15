import { calculateMetric, getMetricDefinition } from '@/lib/analytics';
import type { AnalyticsFact, AnalyticsCoverageState, MetricResult } from '@/lib/analytics';
import { PLAYER_COMPARISON_VERSION, type ComparisonPlayer, type ComparisonValue, type PlayerComparisonRequest, type PlayerComparisonSnapshot } from '@/lib/comparison/types';

function percentile(value: number, population: number[], higherIsBetter: boolean): number | null {
  if (population.length === 0) return null;
  const better = population.filter((candidate) => higherIsBetter ? candidate > value : candidate < value).length;
  const equal = population.filter((candidate) => candidate === value).length;
  return Math.round((((population.length - better - (equal * 0.5)) / population.length) * 100) * 100) / 100;
}

function metricFor(
  metricId: string,
  facts: readonly AnalyticsFact[],
  playerId: string,
  competitionId: string,
  request: PlayerComparisonRequest,
): MetricResult {
  return calculateMetric(metricId, facts, {
    entityType: 'PLAYER', entityId: playerId, competitionId,
    ...(request.lastN ? { window: { lastN: request.lastN } } : {}),
  }, request.aggregation);
}

function valueWithPercentile(
  result: MetricResult,
  player: ComparisonPlayer,
  facts: readonly AnalyticsFact[],
  players: readonly ComparisonPlayer[],
  request: PlayerComparisonRequest,
  competitionId: string,
  higherIsBetter: boolean,
): ComparisonValue {
  if (result.value === null) return { result, positionPercentile: null };
  const population = players
    .filter((candidate) => candidate.position === player.position)
    .map((candidate) => metricFor(result.metricId, facts, candidate.id, competitionId, request))
    .filter((candidate) => candidate.status === 'AVAILABLE' && candidate.value !== null)
    .map((candidate) => candidate.value!);
  return { result, positionPercentile: percentile(result.value, population, higherIsBetter) };
}

function combinedCoverage(metrics: Array<{ result: MetricResult }>): AnalyticsCoverageState {
  if (metrics.length === 0) return 'UNAVAILABLE';
  return metrics.some((metric) => metric.result.coverage === 'PARTIAL') ? 'PARTIAL' : 'AVAILABLE';
}

export function calculatePlayerComparison(
  facts: readonly AnalyticsFact[],
  players: readonly ComparisonPlayer[],
  request: PlayerComparisonRequest,
): PlayerComparisonSnapshot {
  if (request.leftPlayerId === request.rightPlayerId) throw new Error('Choose two different players');
  if (request.metricIds.length < 1 || request.metricIds.length > 5) throw new Error('Choose between one and five metrics');
  if (request.lastN !== undefined && (!Number.isInteger(request.lastN) || request.lastN < 1 || request.lastN > 100)) throw new Error('lastN must be between 1 and 100');
  const leftPlayer = players.find((player) => player.id === request.leftPlayerId);
  const rightPlayer = players.find((player) => player.id === request.rightPlayerId);
  if (!leftPlayer || !rightPlayer) throw new Error('Comparison player not found');

  const metrics: PlayerComparisonSnapshot['metrics'] = [];
  const rejectedMetrics: PlayerComparisonSnapshot['rejectedMetrics'] = [];
  for (const metricId of request.metricIds) {
    const definition = getMetricDefinition(metricId);
    if (!definition || !definition.entityTypes.includes('PLAYER') || definition.calculation.kind === 'SERVICE') continue;
    if (!definition.allowedAggregations.includes(request.aggregation)) {
      rejectedMetrics.push({ metricId, reason: 'UNSUPPORTED_MODE' });
      continue;
    }
    const leftResult = metricFor(metricId, facts, leftPlayer.id, request.leftCompetitionId, request);
    const rightResult = metricFor(metricId, facts, rightPlayer.id, request.rightCompetitionId, request);
    if (leftResult.formulaVersion !== rightResult.formulaVersion) {
      rejectedMetrics.push({ metricId, reason: 'INCOMPATIBLE_FORMULA' });
      continue;
    }
    if (request.leftCompetitionId !== request.rightCompetitionId && leftResult.coverage !== rightResult.coverage) {
      rejectedMetrics.push({ metricId, reason: 'INCOMPATIBLE_COVERAGE' });
      continue;
    }
    if (leftResult.status !== 'AVAILABLE' || rightResult.status !== 'AVAILABLE') {
      rejectedMetrics.push({ metricId, reason: 'UNAVAILABLE_FOR_BOTH' });
      continue;
    }
    metrics.push({
      metricId,
      displayName: definition.displayName,
      definition: definition.definition,
      formulaVersion: definition.formulaVersion,
      left: valueWithPercentile(leftResult, leftPlayer, facts, players, request, request.leftCompetitionId, definition.higherIsBetter),
      right: valueWithPercentile(rightResult, rightPlayer, facts, players, request, request.rightCompetitionId, definition.higherIsBetter),
    });
  }
  const warnings: string[] = [];
  if (metrics.some((metric) => metric.left.result.games !== metric.right.result.games || metric.left.result.minutes !== metric.right.result.minutes)) warnings.push('The players have unequal samples; compare games and minutes before interpreting the values.');
  if (metrics.some((metric) => metric.left.result.coverage !== metric.right.result.coverage)) warnings.push('Source coverage differs between the two player samples.');
  const asOf = metrics.flatMap((metric) => [metric.left.result.asOf, metric.right.result.asOf]).filter((value): value is string => value !== null).toSorted().at(-1) ?? null;
  return {
    version: PLAYER_COMPARISON_VERSION,
    request,
    leftPlayer,
    rightPlayer,
    crossPosition: leftPlayer.position !== rightPlayer.position,
    leadWithPercentiles: leftPlayer.position !== rightPlayer.position,
    metrics,
    rejectedMetrics,
    warnings,
    coverage: { left: combinedCoverage(metrics.map((metric) => metric.left)), right: combinedCoverage(metrics.map((metric) => metric.right)) },
    asOf,
  };
}

