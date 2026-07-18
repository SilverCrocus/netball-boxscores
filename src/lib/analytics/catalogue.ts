import type { AnalyticsRawField, MetricDefinition } from '@/lib/analytics/types';

const boxScoreCapabilities = {
  PLAYER: ['PLAYER_BOX_SCORE'],
  TEAM: ['TEAM_BOX_SCORE'],
} as const;

function countMetric(
  id: string,
  aliases: readonly string[],
  displayName: string,
  field: AnalyticsRawField,
  higherIsBetter = true,
): MetricDefinition {
  return {
    id,
    aliases,
    displayName,
    definition: `${displayName} recorded in the source box score.`,
    entityTypes: ['PLAYER', 'TEAM'],
    unit: 'COUNT',
    allowedAggregations: ['TOTAL', 'PER_GAME', 'PER_60'],
    defaultAggregation: 'TOTAL',
    requiredFields: [field],
    requiredCapabilities: boxScoreCapabilities,
    compatiblePositions: 'ALL',
    minimumSample: { TOTAL: { games: 1 }, PER_GAME: { games: 1 }, PER_60: { minutes: 30 } },
    higherIsBetter,
    formulaVersion: `${id.replaceAll('_', '-')}.v1`,
    calculation: { kind: 'SUM', field },
  };
}

function compositeMetric(
  id: string,
  aliases: readonly string[],
  displayName: string,
  fields: readonly AnalyticsRawField[],
  higherIsBetter = true,
): MetricDefinition {
  return {
    ...countMetric(id, aliases, displayName, fields[0], higherIsBetter),
    definition: `${displayName} is the sum of ${fields.join(', ')} from compatible source box scores.`,
    requiredFields: fields,
    calculation: { kind: 'SUM_FIELDS', fields },
  };
}

export const metricCatalogue: readonly MetricDefinition[] = [
  {
    ...countMetric('goals', ['goals', 'shots made', 'g'], 'Goals', 'goals'),
    definition: 'Successful scoring actions recorded as goals by the source.',
  },
  countMetric('goal_attempts', ['attempts', 'goal attempts', 'shots attempted'], 'Goal attempts', 'attempts'),
  {
    id: 'goal_accuracy',
    aliases: ['goal accuracy', 'shooting percentage', 'shooting accuracy', 'g%'],
    displayName: 'Goal accuracy',
    definition: 'Total goals divided by total attempts; match percentages are never averaged.',
    entityTypes: ['PLAYER', 'TEAM'],
    unit: 'PERCENT',
    allowedAggregations: ['WEIGHTED_PERCENTAGE'],
    defaultAggregation: 'WEIGHTED_PERCENTAGE',
    requiredFields: ['goals', 'attempts'],
    requiredCapabilities: boxScoreCapabilities,
    compatiblePositions: 'ALL',
    minimumSample: { WEIGHTED_PERCENTAGE: { games: 1, attempts: 10 } },
    higherIsBetter: true,
    formulaVersion: 'goal-accuracy.v1',
    calculation: { kind: 'WEIGHTED_PERCENTAGE', numerator: 'goals', denominator: 'attempts' },
  },
  countMetric('goal_assists', ['goal assists', 'assists', 'ga'], 'Goal assists', 'goalAssists'),
  countMetric('intercepts', ['intercepts', 'ints', 'interceptions'], 'Intercepts', 'intercepts'),
  countMetric('gains', ['gains', 'gain'], 'Gains', 'gain'),
  countMetric('deflections', ['deflections'], 'Deflections', 'deflections'),
  countMetric('rebounds', ['rebounds'], 'Rebounds', 'rebounds'),
  countMetric('feeds', ['feeds'], 'Feeds', 'feeds'),
  countMetric(
    'centre_pass_receives',
    ['centre pass receives', 'cpr'],
    'Centre pass receives',
    'centrePassReceives',
  ),
  countMetric('pickups', ['pickups'], 'Pickups', 'pickups'),
  countMetric('turnovers', ['turnovers'], 'Turnovers', 'turnovers', false),
  countMetric('penalties', ['penalties'], 'Penalties', 'penalties', false),
  {
    ...countMetric(
      'shooting_volume',
      ['shooting volume', 'attempt volume', 'attempts per 60'],
      'Shooting volume',
      'attempts',
    ),
    definition: 'Goal attempts per 60 minutes.',
    allowedAggregations: ['PER_60'],
    defaultAggregation: 'PER_60',
    formulaVersion: 'shooting-volume.v1',
  },
  compositeMetric(
    'attacking_involvement',
    ['attacking involvement', 'attack involvement'],
    'Attacking involvement',
    ['goalAssists', 'feeds', 'centrePassReceives'],
  ),
  compositeMetric(
    'defensive_activity',
    ['defensive activity', 'defensive actions'],
    'Defensive activity',
    ['gain', 'intercepts', 'deflections', 'rebounds', 'pickups'],
  ),
  {
    id: 'gain_to_turnover_ratio',
    aliases: ['gain to turnover ratio', 'gains per turnover'],
    displayName: 'Gain-to-turnover ratio',
    definition: 'Total gains divided by total turnovers across the selected matches.',
    entityTypes: ['PLAYER', 'TEAM'],
    unit: 'RATING',
    allowedAggregations: ['RATING'],
    defaultAggregation: 'RATING',
    requiredFields: ['gain', 'turnovers'],
    requiredCapabilities: boxScoreCapabilities,
    compatiblePositions: 'ALL',
    minimumSample: { RATING: { games: 1 } },
    higherIsBetter: true,
    formulaVersion: 'gain-to-turnover-ratio.v1',
    calculation: { kind: 'RATIO', numeratorFields: ['gain'], denominatorFields: ['turnovers'] },
  },
  ...([
    ['team_goal_differential', ['goal differential', 'score differential'], 'Goal differential', 'goalDifferential'],
    ['team_turnover_differential', ['turnover differential'], 'Turnover differential', 'turnoverDifferential'],
    ['team_shooting_differential', ['shooting differential'], 'Shooting percentage differential', 'shootingPercentageDifferential'],
  ] as const).map(([id, aliases, displayName, field]): MetricDefinition => ({
    id,
    aliases,
    displayName,
    definition: `${displayName} against the opponent in the same official match.`,
    entityTypes: ['TEAM'],
    unit: field === 'shootingPercentageDifferential' ? 'PERCENT' : 'COUNT',
    allowedAggregations: ['TOTAL', 'PER_GAME'],
    defaultAggregation: 'PER_GAME',
    requiredFields: [field],
    requiredCapabilities: { TEAM: ['TEAM_BOX_SCORE'] },
    compatiblePositions: 'ALL',
    minimumSample: { TOTAL: { games: 1 }, PER_GAME: { games: 1 } },
    higherIsBetter: true,
    formulaVersion: `${id.replaceAll('_', '-')}.v1`,
    calculation: { kind: 'SUM', field },
  })),
  {
    id: 'centrepass_impact',
    aliases: ['centrepass impact', 'impact rating', 'cp impact'],
    displayName: 'CentrePass Impact',
    definition: 'Position-aware, per-60 standardized contribution rating with sample shrinkage.',
    entityTypes: ['PLAYER'],
    unit: 'RATING',
    allowedAggregations: ['RATING'],
    defaultAggregation: 'RATING',
    requiredFields: [],
    requiredCapabilities: { PLAYER: ['PLAYER_BOX_SCORE'] },
    compatiblePositions: 'ALL',
    minimumSample: { RATING: { minutes: 30 } },
    higherIsBetter: true,
    formulaVersion: 'centrepass-impact.v1',
    calculation: { kind: 'SERVICE', service: 'CENTREPASS_IMPACT_V1' },
  },
  {
    id: 'net_points',
    aliases: ['net points', 'netpoints'],
    displayName: 'Official Net Points',
    definition: 'The official source-supplied Net Points value; this is not CentrePass Impact.',
    entityTypes: ['PLAYER', 'TEAM'],
    unit: 'POINTS',
    allowedAggregations: ['TOTAL', 'PER_GAME', 'PER_60'],
    defaultAggregation: 'TOTAL',
    requiredFields: ['netPoints'],
    requiredCapabilities: {
      PLAYER: ['PLAYER_BOX_SCORE', 'NET_POINTS'],
      TEAM: ['TEAM_BOX_SCORE', 'NET_POINTS'],
    },
    compatiblePositions: 'ALL',
    minimumSample: { TOTAL: { games: 1 }, PER_GAME: { games: 1 }, PER_60: { minutes: 30 } },
    higherIsBetter: true,
    formulaVersion: 'official-net-points.source',
    calculation: { kind: 'SUM', field: 'netPoints' },
  },
];

const metricsById = new Map<string, MetricDefinition>(
  metricCatalogue.map((definition) => [definition.id, definition]),
);

export function getMetricDefinition(metricId: string): MetricDefinition | undefined {
  return metricsById.get(metricId);
}

export function findMetricCandidates(input: string): MetricDefinition[] {
  const normalized = input.trim().toLocaleLowerCase();
  return metricCatalogue.filter((metric) =>
    metric.id === normalized || metric.aliases.some((alias) => alias.toLocaleLowerCase() === normalized),
  );
}
