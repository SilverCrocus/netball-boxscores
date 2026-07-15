import { getMetricDefinition } from '@/lib/analytics/catalogue';
import type {
  AnalyticsCoverageState,
  AnalyticsFact,
  MetricAggregation,
  MetricQueryContext,
  MetricResult,
} from '@/lib/analytics/types';

const FINAL_QUALITIES = new Set(['OFFICIAL_FINAL', 'CORRECTED']);
const USABLE_COVERAGE = new Set<AnalyticsCoverageState>(['AVAILABLE', 'PARTIAL']);

function isOfficialFact(fact: AnalyticsFact): boolean {
  return fact.status === 'COMPLETED'
    && FINAL_QUALITIES.has(fact.resultQuality)
    && !fact.isSimulation;
}

function isInContext(fact: AnalyticsFact, context: MetricQueryContext): boolean {
  return fact.entityType === context.entityType
    && fact.entityId === context.entityId
    && fact.competitionId === context.competitionId
    && (!context.stageId || fact.stageId === context.stageId)
    && (!context.stageGroupId || fact.stageGroupId === context.stageGroupId)
    && (!context.window?.from || fact.scheduledAt >= context.window.from)
    && (!context.window?.to || fact.scheduledAt <= context.window.to);
}

function selectWindow(facts: AnalyticsFact[], context: MetricQueryContext): AnalyticsFact[] {
  const ordered = facts.toSorted((left, right) => {
    const dateDifference = right.scheduledAt.getTime() - left.scheduledAt.getTime();
    return dateDifference || right.matchId.localeCompare(left.matchId);
  });
  const lastN = context.window?.lastN;
  if (lastN === undefined) return ordered;
  if (!Number.isInteger(lastN) || lastN < 1 || lastN > 100) {
    throw new Error('lastN must be an integer between 1 and 100');
  }
  return ordered.slice(0, lastN);
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateMetric(
  metricId: string,
  facts: readonly AnalyticsFact[],
  context: MetricQueryContext,
  aggregation?: MetricAggregation,
): MetricResult {
  const metric = getMetricDefinition(metricId);
  if (!metric) throw new Error(`Unknown metric: ${metricId}`);
  if (!metric.entityTypes.includes(context.entityType)) {
    throw new Error(`${metricId} is not valid for ${context.entityType.toLocaleLowerCase()} queries`);
  }

  const resolvedAggregation = aggregation ?? metric.defaultAggregation;
  if (!metric.allowedAggregations.includes(resolvedAggregation)) {
    throw new Error(`${resolvedAggregation} is not supported for ${metricId}`);
  }

  const selected = selectWindow(
    facts.filter((fact) => isOfficialFact(fact) && isInContext(fact, context)),
    context,
  );
  const requiredCapabilities = metric.requiredCapabilities[context.entityType] ?? [];
  const covered = selected.filter((fact) => {
    const capabilitiesAvailable = requiredCapabilities.every((capability) =>
      USABLE_COVERAGE.has(fact.capabilities[capability] ?? 'UNAVAILABLE'),
    );
    const fieldsAvailable = metric.requiredFields.every((field) =>
      typeof fact.stats[field] === 'number' && Number.isFinite(fact.stats[field]),
    );
    return capabilitiesAvailable && fieldsAvailable;
  });

  const games = covered.length;
  const minutes = covered.reduce((total, fact) => total + (fact.stats.minutesPlayed ?? 0), 0);
  const minimumSample = metric.minimumSample[resolvedAggregation] ?? {};
  const attempts = covered.reduce((total, fact) => total + (fact.stats.attempts ?? 0), 0);
  const minimumSampleMet = games >= (minimumSample.games ?? 0)
    && minutes >= (minimumSample.minutes ?? 0)
    && attempts >= (minimumSample.attempts ?? 0);
  const hasPartialCoverage = covered.some((fact) =>
    requiredCapabilities.some((capability) => fact.capabilities[capability] === 'PARTIAL'),
  );
  const coverage: AnalyticsCoverageState = covered.length === 0
    ? 'UNAVAILABLE'
    : covered.length < selected.length || hasPartialCoverage
      ? 'PARTIAL'
      : 'AVAILABLE';

  let value: number | null = null;
  if (covered.length > 0 && minimumSampleMet) {
    const calculation = metric.calculation;
    if (calculation.kind === 'WEIGHTED_PERCENTAGE') {
      const numeratorField = calculation.numerator;
      const denominatorField = calculation.denominator;
      const numerator = covered.reduce(
        (total, fact) => total + (fact.stats[numeratorField] ?? 0),
        0,
      );
      const denominator = covered.reduce(
        (total, fact) => total + (fact.stats[denominatorField] ?? 0),
        0,
      );
      value = denominator > 0 ? round((numerator / denominator) * 100) : null;
    } else {
      const valueField = calculation.field;
      const total = covered.reduce(
        (sum, fact) => sum + (fact.stats[valueField] ?? 0),
        0,
      );
      if (resolvedAggregation === 'PER_GAME') value = round(total / games);
      else if (resolvedAggregation === 'PER_60') value = minutes > 0 ? round((total / minutes) * 60) : null;
      else value = round(total);
    }
  }

  const asOfDate = selected.reduce<Date | null>((latest, fact) => {
    const candidate = fact.sourceUpdatedAt ?? fact.scheduledAt;
    return !latest || candidate > latest ? candidate : latest;
  }, null);

  return {
    metricId,
    value,
    status: covered.length === 0
      ? 'UNAVAILABLE'
      : minimumSampleMet && value !== null
        ? 'AVAILABLE'
        : 'INSUFFICIENT_SAMPLE',
    unit: metric.unit,
    aggregation: resolvedAggregation,
    context,
    games,
    minutes: round(minutes),
    minimumSample,
    minimumSampleMet,
    coverage,
    formulaVersion: metric.formulaVersion,
    asOf: asOfDate?.toISOString() ?? null,
    includedMatchIds: covered.map((fact) => fact.matchId),
  };
}
