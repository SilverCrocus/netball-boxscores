import { getMetricDefinition } from '@/lib/analytics/catalogue';
import type { StatQueryResponse } from '@/lib/stat-query/types';

type UnknownRecord = Record<string, unknown>;

export interface ExploreResultRow {
  id: string;
  label: string;
  meta: string;
  value: number | null;
  valueLabel: string;
  coverage: string;
  games: number | null;
  minutes: number | null;
  includedMatchIds: string[];
  href?: string;
}

export interface ExploreResultModel {
  metricName: string;
  definition: string;
  aggregation: string;
  formulaVersion: string;
  coverageLabel: string;
  rows: ExploreResultRow[];
  includedMatchIds: string[];
  chartable: boolean;
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function formatValue(value: number | null, unit: string): string {
  if (value === null) return 'Unavailable';
  if (unit === 'PERCENT') return `${value.toFixed(1)}%`;
  if (unit === 'RATING') return value.toFixed(2);
  return Number.isInteger(value) ? value.toLocaleString('en-AU') : value.toFixed(1);
}

function rowFromMetricResult(input: {
  id: string;
  label: string;
  meta: string;
  metricResult: UnknownRecord | null;
  href?: string;
}): ExploreResultRow {
  const metricValue = number(input.metricResult?.value);
  return {
    id: input.id,
    label: input.label,
    meta: input.meta,
    value: metricValue,
    valueLabel: formatValue(metricValue, string(input.metricResult?.unit)),
    coverage: string(input.metricResult?.coverage, 'UNAVAILABLE'),
    games: number(input.metricResult?.games),
    minutes: number(input.metricResult?.minutes),
    includedMatchIds: stringArray(input.metricResult?.includedMatchIds),
    ...(input.href ? { href: input.href } : {}),
  };
}

function rowFromRecordEntry(entryValue: unknown, subject: 'PLAYER' | 'TEAM', index: number): ExploreResultRow | null {
  const entry = record(entryValue);
  const entity = record(entry?.entity);
  if (!entry || !entity) return null;
  const id = string(entity.id, `entry-${index}`);
  const slug = string(entity.slug);
  const value = number(entry.value);
  const position = string(entity.position);
  const teamName = string(entity.teamName);
  return {
    id,
    label: string(entity.name, 'Unknown entity'),
    meta: [position, teamName, `${number(entry.games) ?? 0} games`].filter(Boolean).join(' · '),
    value,
    valueLabel: formatValue(value, string(entry.unit)),
    coverage: string(entry.coverage, string(entry.status, 'UNAVAILABLE')),
    games: number(entry.games),
    minutes: number(entry.minutes),
    includedMatchIds: stringArray(entry.includedMatchIds),
    href: subject === 'PLAYER' ? `/player/${id}` : slug ? `/team/${slug}` : undefined,
  };
}

function playerRankingRows(result: UnknownRecord, subject: 'PLAYER' | 'TEAM'): ExploreResultRow[] {
  const entries = Array.isArray(result.entries) ? result.entries : [];
  return entries.flatMap((entryValue, index) => {
    const entry = record(entryValue);
    const entity = record(entry?.entity);
    const metricResult = record(entry?.result);
    if (!entry || !entity || !metricResult) {
      const recordRow = rowFromRecordEntry(entryValue, subject, index);
      return recordRow ? [recordRow] : [];
    }
    const id = string(entity.id, `entry-${index}`);
    return [rowFromMetricResult({
      id,
      label: string(entity.name, 'Unknown player'),
      meta: [string(entity.position), string(entity.teamName), `${number(metricResult.games) ?? 0} games`].filter(Boolean).join(' · '),
      metricResult,
      href: subject === 'PLAYER' ? `/player/${id}` : undefined,
    })];
  });
}

function lookupRows(response: StatQueryResponse, result: UnknownRecord): ExploreResultRow[] {
  const metricResult = record(result.value);
  const entity = record(result.entity);
  if (metricResult && entity) {
    const id = response.spec?.entityIds[0] ?? 'lookup';
    return [rowFromMetricResult({
      id,
      label: string(entity.name, 'Selected player'),
      meta: `${number(metricResult.games) ?? 0} included games`,
      metricResult,
      href: response.spec?.subject === 'PLAYER' ? `/player/${id}` : undefined,
    })];
  }
  const entry = rowFromRecordEntry(result.entry, response.spec?.subject ?? 'TEAM', 0);
  return entry ? [entry] : [];
}

function comparisonRows(response: StatQueryResponse, result: UnknownRecord): ExploreResultRow[] {
  const leftPlayer = record(result.leftPlayer);
  const rightPlayer = record(result.rightPlayer);
  const metrics = Array.isArray(result.metrics) ? result.metrics : [];
  return metrics.flatMap((metricValue, metricIndex) => {
    const metric = record(metricValue);
    if (!metric) return [];
    const displayName = string(metric.displayName, response.spec?.metrics[metricIndex]?.id ?? 'Metric');
    return ([['left', leftPlayer], ['right', rightPlayer]] as const).flatMap(([side, player]) => {
      const sideValue = record(metric[side]);
      const metricResult = record(sideValue?.result);
      if (!player || !metricResult) return [];
      const id = string(player.id, `${side}-${metricIndex}`);
      return [rowFromMetricResult({
        id: `${displayName}-${id}`,
        label: string(player.name, side === 'left' ? 'Player one' : 'Player two'),
        meta: [displayName, string(player.position), string(player.teamName)].filter(Boolean).join(' · '),
        metricResult,
        href: `/player/${id}`,
      })];
    });
  });
}

export function buildExploreResultModel(response: StatQueryResponse): ExploreResultModel | null {
  if (response.status !== 'READY' || !response.spec) return null;
  const result = record(response.result);
  if (!result) return null;
  const metricId = response.spec.metrics[0]?.id;
  const definition = metricId ? getMetricDefinition(metricId) : undefined;
  const rows = response.spec.intent === 'LOOKUP'
    ? lookupRows(response, result)
    : response.spec.intent === 'COMPARISON'
      ? comparisonRows(response, result)
      : playerRankingRows(result, response.spec.subject);
  const includedMatchIds = [...new Set(rows.flatMap((row) => row.includedMatchIds))];
  const formulaVersion = string(result.formulaVersion)
    || string(record(result.value)?.formulaVersion)
    || string(record((Array.isArray(result.entries) ? result.entries[0] : null))?.formulaVersion)
    || definition?.formulaVersion
    || 'Registered formula';
  const coverageValues = [...new Set(rows.map((row) => row.coverage.toLocaleLowerCase()))];
  return {
    metricName: definition?.displayName ?? metricId ?? 'Selected metric',
    definition: definition?.definition ?? 'Calculated from the registered CentrePass metric catalogue.',
    aggregation: response.spec.metrics[0]?.aggregation.toLocaleLowerCase().replaceAll('_', ' ') ?? 'value',
    formulaVersion,
    coverageLabel: coverageValues.length > 0 ? coverageValues.join(' · ') : 'unavailable',
    rows,
    includedMatchIds,
    chartable: rows.length > 1 && response.spec.metrics.length === 1 && rows.some((row) => row.value !== null),
  };
}
