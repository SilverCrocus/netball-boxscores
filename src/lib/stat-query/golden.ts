import type { MetricAggregation } from '@/lib/analytics';
import { QUERY_SPEC_VERSION, type ParserContext, type QuerySpecV1 } from '@/lib/stat-query/types';

export const GOLDEN_CORPUS_VERSION = 'centrepass-golden.v1';

export const goldenParserContext: ParserContext = {
  entities: [
    { id: 'player-grace', kind: 'PLAYER', name: 'Grace Nweke', aliases: ['G Nweke'], position: 'GS' },
    { id: 'player-shamera', kind: 'PLAYER', name: 'Shamera Sterling-Humphrey', aliases: ['Shamera Sterling', 'Sterling Humphrey'], position: 'GK' },
    { id: 'player-georgie', kind: 'PLAYER', name: 'Georgie Horjus', aliases: ['G Horjus'], position: 'GA' },
    { id: 'player-latanya', kind: 'PLAYER', name: 'Latanya Wilson', aliases: ['L Wilson'], position: 'GD' },
    { id: 'team-vixens', kind: 'TEAM', name: 'Melbourne Vixens', aliases: ['Vixens', 'VIX'] },
  ],
  editions: [{ id: 'edition-ssn-2026', name: 'SSN 2026', aliases: ['Suncorp Super Netball 2026', '2026 SSN'] }],
  stages: [{ id: 'stage-pool', competitionId: 'edition-ssn-2026', name: 'Pool stage', aliases: ['pools'] }],
  groups: [{ id: 'group-a', competitionId: 'edition-ssn-2026', name: 'Pool A', aliases: ['group a'] }],
  defaultEditionId: 'edition-ssn-2026',
};

export interface GoldenQuestion {
  id: string;
  question: string;
  expected: QuerySpecV1;
}

const players = goldenParserContext.entities.filter((entity) => entity.kind === 'PLAYER');
const metrics = [
  ['goals', 'goals'], ['goal_assists', 'goal assists'], ['intercepts', 'intercepts'],
  ['gains', 'gains'], ['deflections', 'deflections'], ['rebounds', 'rebounds'],
  ['feeds', 'feeds'], ['turnovers', 'turnovers'], ['penalties', 'penalties'], ['pickups', 'pickups'],
] as const;
const modes: Array<[MetricAggregation, string]> = [['TOTAL', 'total'], ['PER_GAME', 'per game'], ['PER_60', 'per 60']];

function spec(input: Partial<QuerySpecV1> & Pick<QuerySpecV1, 'intent' | 'subject' | 'entityIds' | 'metrics'>): QuerySpecV1 {
  return {
    version: QUERY_SPEC_VERSION,
    filters: { editionId: 'edition-ssn-2026', officialCompletedOnly: true, excludeSimulations: true },
    window: { type: 'EDITION' }, groupBy: 'NONE', order: 'DESC', minimumMinutes: 0, limit: 1,
    ...input,
  };
}

const lookupQuestions: GoldenQuestion[] = players.flatMap((player) => metrics.flatMap(([metricId, phrase]) => modes.flatMap(([aggregation, mode]) => [
  {
    id: `lookup-${player.id}-${metricId}-${aggregation}-edition`,
    question: `${player.name} ${phrase} ${mode} in SSN 2026`,
    expected: spec({ intent: 'LOOKUP', subject: 'PLAYER', entityIds: [player.id], metrics: [{ id: metricId, aggregation }] }),
  },
  {
    id: `lookup-${player.id}-${metricId}-${aggregation}-last5`,
    question: `What were ${player.name} ${phrase} ${mode} in the last 5 games in SSN 2026?`,
    expected: spec({ intent: 'LOOKUP', subject: 'PLAYER', entityIds: [player.id], metrics: [{ id: metricId, aggregation }], window: { type: 'LAST_N', lastN: 5 } }),
  },
])));

const leaderboardQuestions: GoldenQuestion[] = metrics.flatMap(([metricId, phrase]) => modes.map(([aggregation, mode]) => ({
  id: `leaderboard-${metricId}-${aggregation}`,
  question: `Who had the most ${phrase} ${mode} in SSN 2026 top 10 minimum 120 minutes?`,
  expected: spec({
    intent: 'LEADERBOARD', subject: 'PLAYER', entityIds: [], metrics: [{ id: metricId, aggregation }],
    groupBy: 'ENTITY', minimumMinutes: 120, limit: 10,
  }),
})));

const comparisonQuestions: GoldenQuestion[] = metrics.slice(0, 5).flatMap(([metricId, phrase]) => modes.map(([aggregation, mode]) => ({
  id: `comparison-${metricId}-${aggregation}`,
  question: `Compare Grace Nweke versus Shamera Sterling-Humphrey for ${phrase} ${mode} in SSN 2026 last 5 games`,
  expected: spec({
    intent: 'COMPARISON', subject: 'PLAYER', entityIds: ['player-grace', 'player-shamera'], metrics: [{ id: metricId, aggregation }],
    window: { type: 'LAST_N', lastN: 5 }, groupBy: 'ENTITY', limit: 2,
  }),
})));

const recordQuestions: GoldenQuestion[] = metrics.map(([metricId, phrase]) => ({
  id: `record-${metricId}`,
  question: `Highest ${phrase} in a match in SSN 2026 top 10`,
  expected: spec({
    intent: 'RECORD', subject: 'PLAYER', entityIds: [], metrics: [{ id: metricId, aggregation: 'TOTAL' }],
    groupBy: 'MATCH', limit: 10, recordScope: 'SINGLE_MATCH',
  }),
}));

export const goldenQuestions: readonly GoldenQuestion[] = [
  ...lookupQuestions,
  ...leaderboardQuestions,
  ...comparisonQuestions,
  ...recordQuestions,
];
