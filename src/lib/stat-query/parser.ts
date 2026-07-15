import type { AnalyticsEntityType, MetricAggregation, MetricDefinition } from '@/lib/analytics';
import { normalizeStatQuestion } from '@/lib/stat-query/normalize';
import { inputPolicyError, validateQuerySpec } from '@/lib/stat-query/policy';
import { resolveEditions, resolveEntities, resolveMetrics, resolveScopeCandidates } from '@/lib/stat-query/resolver';
import { QUERY_SPEC_VERSION, RULE_PARSER_VERSION, type ParseResult, type ParserContext, type QueryIntent, type QuerySpecV1 } from '@/lib/stat-query/types';

function intentFor(question: string): QueryIntent {
  if (/\b(compare|versus|vs)\b/.test(question)) return 'COMPARISON';
  if (/\b(record|highest recorded|most in (a|one) (match|game)|single[- ]match)\b/.test(question) || /\bhighest\b.*\bin (a|one) (match|game)\b/.test(question)) return 'RECORD';
  if (/\b(who|which player|which team|top\s+\d+)\b/.test(question) && /\b(most|highest|least|fewest|best|top)\b/.test(question)) return 'LEADERBOARD';
  return 'LOOKUP';
}

function requestedAggregation(question: string, metric: MetricDefinition): MetricAggregation {
  if (/\b(per 60|per60|per sixty)\b/.test(question)) return 'PER_60';
  if (/\b(average|avg|per game|per match)\b/.test(question)) return 'PER_GAME';
  if (/\b(total|combined|altogether)\b/.test(question)) return 'TOTAL';
  return metric.defaultAggregation;
}

function lastNFor(question: string): number | undefined {
  const match = question.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+(?:games?|matches?)\b/);
  return match ? Number(match[1]) : undefined;
}

function dateRangeFor(question: string): { from: string; to: string } | null {
  const match = question.match(/\b(?:from|between)\s+(\d{4}-\d{2}-\d{2})\s+(?:to|and)\s+(\d{4}-\d{2}-\d{2})\b/);
  if (!match) return null;
  const from = new Date(`${match[1]}T00:00:00.000Z`);
  const to = new Date(`${match[2]}T23:59:59.999Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return null;
  return { from: from.toISOString(), to: to.toISOString() };
}

function limitFor(question: string): number {
  const match = question.match(/\btop\s+(\d{1,3})\b/);
  return match ? Number(match[1]) : 10;
}

function minimumMinutesFor(question: string): number {
  const match = question.match(/\b(?:minimum|min)\s+(\d{1,5})\s+minutes?\b/);
  return match ? Number(match[1]) : 120;
}

function clarification(reason: Extract<ParseResult, { status: 'NEEDS_CLARIFICATION' }>['reason'], question: string, options: Array<{ id: string; label: string }>): ParseResult {
  return { status: 'NEEDS_CLARIFICATION', reason, question, options: options.slice(0, 5), parserVersion: RULE_PARSER_VERSION };
}

export function parseStatQuestion(input: string, context: ParserContext): ParseResult {
  const policyError = inputPolicyError(input);
  if (policyError) return { status: 'UNSUPPORTED', code: 'INPUT_POLICY', message: policyError, parserVersion: RULE_PARSER_VERSION };
  const question = normalizeStatQuestion(input);
  const intent = intentFor(question);
  const entityMatches = resolveEntities(question, context.entities);
  const metricMatches = resolveMetrics(question);
  const editionMatches = resolveEditions(question, context.editions);
  const editionId = editionMatches[0]?.id ?? context.defaultEditionId;
  if (!editionId) return clarification('EDITION_MISSING', 'Which competition edition should I use?', context.editions.map((edition) => ({ id: edition.id, label: edition.name })));
  const stageMatch = resolveScopeCandidates(question, context.stages ?? [], editionId)[0];
  const groupMatch = resolveScopeCandidates(question, context.groups ?? [], editionId)[0];

  if ((/\bbest\b/.test(question) || /\baverage\b/.test(question)) && metricMatches.length === 0) {
    return clarification('METRIC_MISSING', 'Which statistic should I use?', [
      { id: 'goals', label: 'Goals' }, { id: 'goal_assists', label: 'Goal assists' },
      { id: 'intercepts', label: 'Intercepts' }, { id: 'centrepass_impact', label: 'CentrePass Impact' },
    ]);
  }
  if (metricMatches.length === 0 && intent !== 'COMPARISON') {
    return clarification('METRIC_MISSING', 'Which statistic would you like?', [
      { id: 'goals', label: 'Goals' }, { id: 'goal_assists', label: 'Goal assists' }, { id: 'intercepts', label: 'Intercepts' },
    ]);
  }
  const metrics = (metricMatches.length > 0 ? metricMatches : resolveMetrics('goals goal assists defensive activity turnovers penalties')).slice(0, 5);
  const aggregation = requestedAggregation(question, metrics[0]);
  const supportedMetrics = metrics.filter((metric) => metric.allowedAggregations.includes(aggregation) && metric.calculation.kind !== 'SERVICE');
  if (supportedMetrics.length === 0) return { status: 'UNSUPPORTED', code: 'UNSUPPORTED_AGGREGATION', message: `${aggregation.toLocaleLowerCase()} is not supported for that statistic.`, parserVersion: RULE_PARSER_VERSION };

  let subject: AnalyticsEntityType = entityMatches[0]?.kind ?? (/\bteams?\b/.test(question) ? 'TEAM' : 'PLAYER');
  let entityIds: string[] = [];
  if (intent === 'LOOKUP') {
    if (entityMatches.length === 0) return clarification('ENTITY_MISSING', `Which ${subject.toLocaleLowerCase()} should I look up?`, []);
    subject = entityMatches[0].kind;
    entityIds = [entityMatches[0].id];
  } else if (intent === 'COMPARISON') {
    const players = entityMatches.filter((entity) => entity.kind === 'PLAYER').filter((entity, index, all) => all.findIndex((candidate) => candidate.id === entity.id) === index);
    if (players.length < 2) return clarification('COMPARISON_NEEDS_TWO_PLAYERS', 'Which two players should I compare?', players.map((player) => ({ id: player.id, label: player.name })));
    subject = 'PLAYER';
    entityIds = players.slice(0, 2).map((player) => player.id);
  }
  const lastN = lastNFor(question);
  const dateRange = dateRangeFor(question);
  if (dateRange && (intent === 'COMPARISON' || intent === 'RECORD')) {
    return { status: 'UNSUPPORTED', code: 'UNSUPPORTED_DATE_WINDOW', message: 'Date ranges currently support lookups and leaderboards.', parserVersion: RULE_PARSER_VERSION };
  }
  if ((stageMatch || groupMatch) && (intent === 'COMPARISON' || intent === 'RECORD')) {
    return { status: 'UNSUPPORTED', code: 'UNSUPPORTED_SCOPE_FILTER', message: 'Stage and group filters currently support lookups and leaderboards.', parserVersion: RULE_PARSER_VERSION };
  }
  const opponent = intent === 'LOOKUP' && /\b(against|v)\b/.test(question)
    ? entityMatches.find((entity) => entity.kind === 'TEAM')
    : undefined;
  if (subject === 'TEAM' && (lastN || dateRange || stageMatch || groupMatch || opponent)) {
    return { status: 'UNSUPPORTED', code: 'UNSUPPORTED_TEAM_SCOPE', message: 'Scoped team queries are not supported until the team fact service can apply the requested window.', parserVersion: RULE_PARSER_VERSION };
  }
  const isAscending = /\b(least|fewest|lowest)\b/.test(question);
  const recordScope = /\b(career)\b/.test(question) ? 'CAREER'
    : /\b(finals?|semi finals?|playoffs?)\b/.test(question) ? 'FINALS'
      : /\b(single match|single game|in a match|in one match|in a game|in one game)\b/.test(question) ? 'SINGLE_MATCH'
        : /\bcentrepass era\b/.test(question) ? 'CENTREPASS_ERA'
          : subject === 'TEAM' ? 'TEAM' : 'EDITION';
  const spec: QuerySpecV1 = {
    version: QUERY_SPEC_VERSION,
    intent,
    subject,
    entityIds,
    metrics: supportedMetrics.map((metric) => ({ id: metric.id, aggregation })),
    filters: {
      editionId,
      ...(stageMatch ? { stageId: stageMatch.id } : {}),
      ...(groupMatch ? { stageGroupId: groupMatch.id } : {}),
      ...(opponent ? { opponentId: opponent.id } : {}),
      officialCompletedOnly: true,
      excludeSimulations: true,
    },
    window: lastN ? { type: 'LAST_N', lastN } : dateRange ? { type: 'DATE_RANGE', ...dateRange } : { type: 'EDITION' },
    groupBy: intent === 'RECORD' && recordScope === 'SINGLE_MATCH' ? 'MATCH' : intent === 'LOOKUP' ? 'NONE' : 'ENTITY',
    order: isAscending ? 'ASC' : 'DESC',
    minimumMinutes: intent === 'LEADERBOARD' && subject === 'PLAYER' ? minimumMinutesFor(question) : 0,
    limit: intent === 'COMPARISON' ? 2 : intent === 'LOOKUP' ? 1 : limitFor(question),
    ...(intent === 'RECORD' ? { recordScope } : {}),
  };
  try {
    validateQuerySpec(spec);
  } catch (error) {
    return { status: 'UNSUPPORTED', code: 'POLICY_LIMIT', message: error instanceof Error ? error.message : 'Query exceeds a safety limit.', parserVersion: RULE_PARSER_VERSION };
  }
  const entityLabels = entityIds.map((id) => context.entities.find((entity) => entity.id === id)?.name ?? id);
  const metricLabels = supportedMetrics.map((metric) => metric.displayName).join(', ');
  const windowLabel = lastN ? `last ${lastN} completed matches` : dateRange ? `${dateRange.from.slice(0, 10)} to ${dateRange.to.slice(0, 10)}` : 'selected edition';
  return { status: 'READY', spec, interpretation: `${intent.toLocaleLowerCase()}: ${entityLabels.join(' vs ') || subject.toLocaleLowerCase()} · ${metricLabels} · ${aggregation.toLocaleLowerCase().replaceAll('_', ' ')} · ${windowLabel}`, parserVersion: RULE_PARSER_VERSION };
}
