import { calculateMetric, getMetricDefinition } from '@/lib/analytics';
import { getPlayerComparison } from '@/lib/comparison/service';
import { prisma } from '@/lib/db';
import { getCompetitionPlayerFacts } from '@/lib/player-analytics';
import { getPlayerRankingSnapshot } from '@/lib/rankings/service';
import { getRecordSnapshot } from '@/lib/records/service';
import type { QuerySpecV1 } from '@/lib/stat-query/types';

export interface ExecutedStatQuery {
  answer: string;
  result: unknown;
  asOf: string | null;
}

function numberLabel(value: number | null, unit: string): string {
  if (value === null) return 'unavailable';
  return unit === 'PERCENT' ? `${value.toFixed(1)}%` : value.toFixed(1);
}

function aggregationLabel(aggregation: string): string {
  if (aggregation === 'PER_GAME') return ' per game';
  if (aggregation === 'PER_60') return ' per 60 minutes';
  return '';
}

function orderByValue<T>(entries: readonly T[], valueFor: (entry: T) => number | null, order: QuerySpecV1['order']): T[] {
  return entries.toSorted((left, right) => {
    const leftValue = valueFor(left);
    const rightValue = valueFor(right);
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return order === 'ASC' ? leftValue - rightValue : rightValue - leftValue;
  });
}

async function executeLookup(spec: QuerySpecV1): Promise<ExecutedStatQuery> {
  const metric = spec.metrics[0];
  if (spec.subject === 'PLAYER') {
    const [rawFacts, player, opponentMatches] = await Promise.all([
      getCompetitionPlayerFacts(spec.filters.editionId),
      prisma.player.findUnique({ where: { id: spec.entityIds[0] }, select: { name: true } }),
      spec.filters.opponentId ? prisma.match.findMany({
        where: {
          competitionId: spec.filters.editionId,
          status: 'COMPLETED', resultQuality: { in: ['OFFICIAL_FINAL', 'CORRECTED'] }, isSimulation: false,
          OR: [{ homeTeamId: spec.filters.opponentId }, { awayTeamId: spec.filters.opponentId }],
        },
        select: { id: true },
      }) : Promise.resolve(null),
    ]);
    if (!player) throw new Error('Player not found');
    const opponentMatchIds = opponentMatches ? new Set(opponentMatches.map((match) => match.id)) : null;
    const facts = opponentMatchIds ? rawFacts.filter((fact) => opponentMatchIds.has(fact.matchId)) : rawFacts;
    const result = calculateMetric(metric.id, facts, {
      entityType: 'PLAYER', entityId: spec.entityIds[0], competitionId: spec.filters.editionId,
      ...(spec.filters.stageId ? { stageId: spec.filters.stageId } : {}),
      ...(spec.filters.stageGroupId ? { stageGroupId: spec.filters.stageGroupId } : {}),
      ...(spec.window.type === 'LAST_N' ? { window: { lastN: spec.window.lastN } }
        : spec.window.type === 'DATE_RANGE' ? { window: { from: new Date(spec.window.from!), to: new Date(spec.window.to!) } } : {}),
    }, metric.aggregation);
    const definition = getMetricDefinition(metric.id)!;
    return {
      answer: `${player.name} ${result.aggregation === 'PER_GAME' ? 'averaged' : 'recorded'} ${numberLabel(result.value, result.unit)} ${definition.displayName.toLocaleLowerCase()}${aggregationLabel(result.aggregation)} across ${result.games} included ${result.games === 1 ? 'match' : 'matches'}.`,
      result: { entity: player, metric: definition, value: result },
      asOf: result.asOf,
    };
  }
  const snapshot = await getRecordSnapshot({ scope: 'TEAM', metricId: metric.id, aggregation: metric.aggregation, entityType: 'TEAM', competitionId: spec.filters.editionId, limit: 100 });
  const entry = snapshot.entries.find((candidate) => candidate.entity.id === spec.entityIds[0]);
  if (!entry) return { answer: 'That statistic is unavailable for the selected team and edition.', result: { entry: null, snapshot }, asOf: snapshot.asOf };
  return { answer: `${entry.entity.name} recorded ${numberLabel(entry.value, entry.unit)} for ${getMetricDefinition(metric.id)?.displayName.toLocaleLowerCase()}.`, result: { entry, snapshot }, asOf: snapshot.asOf };
}

async function executeLeaderboard(spec: QuerySpecV1): Promise<ExecutedStatQuery> {
  const metric = spec.metrics[0];
  if (spec.subject === 'PLAYER') {
    const snapshot = await getPlayerRankingSnapshot({
      competitionId: spec.filters.editionId, metricId: metric.id, aggregation: metric.aggregation,
      position: spec.filters.position, lastN: spec.window.type === 'LAST_N' ? spec.window.lastN : undefined,
      stageId: spec.filters.stageId, stageGroupId: spec.filters.stageGroupId,
      from: spec.window.type === 'DATE_RANGE' ? new Date(spec.window.from!) : undefined,
      to: spec.window.type === 'DATE_RANGE' ? new Date(spec.window.to!) : undefined,
      minimumMinutes: spec.minimumMinutes,
    });
    const entries = orderByValue(snapshot.entries, (entry) => entry.result.value, spec.order)
      .slice(0, spec.limit)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
    const leader = entries[0];
    return {
      answer: leader ? `${leader.entity.name} leads with ${numberLabel(leader.result.value, leader.result.unit)} ${getMetricDefinition(metric.id)?.displayName.toLocaleLowerCase()}${aggregationLabel(leader.result.aggregation)}.` : 'No players meet the selected sample and coverage rules.',
      result: { ...snapshot, entries }, asOf: snapshot.asOf,
    };
  }
  const snapshot = await getRecordSnapshot({ scope: 'TEAM', metricId: metric.id, aggregation: metric.aggregation, entityType: 'TEAM', competitionId: spec.filters.editionId, limit: 100 });
  const entries = orderByValue(snapshot.entries, (entry) => entry.value, spec.order).slice(0, spec.limit);
  return { answer: entries[0] ? `${entries[0].entity.name} leads with ${numberLabel(entries[0].value, entries[0].unit)} ${getMetricDefinition(metric.id)?.displayName.toLocaleLowerCase()}${aggregationLabel(metric.aggregation)}.` : 'No teams meet the selected coverage rules.', result: { ...snapshot, entries }, asOf: snapshot.asOf };
}

async function executeComparison(spec: QuerySpecV1): Promise<ExecutedStatQuery> {
  const snapshot = await getPlayerComparison({
    leftPlayerId: spec.entityIds[0], rightPlayerId: spec.entityIds[1],
    leftCompetitionId: spec.filters.editionId, rightCompetitionId: spec.filters.editionId,
    aggregation: spec.metrics[0].aggregation, metricIds: spec.metrics.map((metric) => metric.id),
    lastN: spec.window.type === 'LAST_N' ? spec.window.lastN : undefined,
  });
  return { answer: `${snapshot.leftPlayer.name} and ${snapshot.rightPlayer.name} were compared across ${snapshot.metrics.length} compatible metrics.`, result: snapshot, asOf: snapshot.asOf };
}

async function executeRecord(spec: QuerySpecV1): Promise<ExecutedStatQuery> {
  const metric = spec.metrics[0];
  const snapshot = await getRecordSnapshot({
    scope: spec.recordScope ?? 'EDITION', metricId: metric.id, aggregation: metric.aggregation,
    entityType: spec.subject, competitionId: spec.filters.editionId, limit: 100,
  });
  const entries = orderByValue(snapshot.entries, (candidate) => candidate.value, spec.order).slice(0, spec.limit);
  const entry = entries[0];
  return { answer: entry ? `${entry.entity.name} holds the ${snapshot.coverageLabel.toLocaleLowerCase()} mark with ${numberLabel(entry.value, entry.unit)} ${getMetricDefinition(metric.id)?.displayName.toLocaleLowerCase()}.` : 'No covered record is available for that query.', result: { ...snapshot, entries }, asOf: snapshot.asOf };
}

export async function executeQuerySpec(spec: QuerySpecV1): Promise<ExecutedStatQuery> {
  if (spec.intent === 'LOOKUP') return executeLookup(spec);
  if (spec.intent === 'LEADERBOARD') return executeLeaderboard(spec);
  if (spec.intent === 'COMPARISON') return executeComparison(spec);
  return executeRecord(spec);
}
