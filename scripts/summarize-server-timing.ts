import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SERVER_PHASE_NAMES } from '@/lib/server-timing';

export const DEFAULT_MIN_SAMPLES = 20;
export const MAX_TIMING_GROUPS = 64;
const MAX_DURATION_MS = 300_000;
const COVERAGE_ROUNDING_TOLERANCE_MS = 0.2;
const STABLE_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const STABLE_ROUTE = /^\/[A-Za-z0-9/_\-[\]]{0,63}$/;
const KNOWN_PHASES = new Set<string>(SERVER_PHASE_NAMES);

type TimingEvent = Record<string, unknown>;

export interface TimingGroupSummary {
  route: string;
  operation: string;
  name?: string;
  count: number;
  p50Ms: number;
  p95Ms: number;
  sufficientSamples: boolean;
}

export interface PhaseCoverageSummary {
  route: string;
  operation: string;
  count: number;
  p50Pct: number;
  p95Pct: number;
  atLeast95Pct: number;
  sufficientSamples: boolean;
}

export interface ServerTimingSummary {
  schemaVersion: 1;
  minSamples: number;
  parsedLineCount: number;
  validSampleCount: number;
  invalidLineCount: number;
  ignoredEventCount: number;
  invalidReasons: string[];
  coverageSampleCount: number;
  coverageInvalidCount: number;
  coverageInvalidReasons: string[];
  operations: TimingGroupSummary[];
  phases: TimingGroupSummary[];
  queries: TimingGroupSummary[];
  phaseCoverage: PhaseCoverageSummary[];
}

interface TimingGroup {
  route: string;
  operation: string;
  name?: string;
  durations: number[];
}

interface CoverageGroup {
  route: string;
  operation: string;
  ratios: number[];
}

interface SummarizeOptions {
  minSamples?: number;
}

function isRecord(value: unknown): value is TimingEvent {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeRoute(value: unknown): value is string {
  return value === 'unknown' || (typeof value === 'string' && STABLE_ROUTE.test(value));
}

function safeName(value: unknown): value is string {
  return typeof value === 'string' && STABLE_NAME.test(value);
}

function readDuration(event: TimingEvent): number | null {
  const value = event.durationMs;
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= MAX_DURATION_MS
    ? value
    : null;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Nearest-rank quantiles keep reports deterministic for small samples. */
function quantile(values: readonly number[], probability: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * probability) - 1);
  return rounded(sorted[index] ?? 0);
}

function groupKey(route: string, operation: string, name?: string): string {
  return `${route}\u0000${operation}\u0000${name ?? ''}`;
}

function addSample(
  groups: Map<string, TimingGroup>,
  event: TimingEvent,
  name: string | undefined,
  durationMs: number,
  invalidReasons: Set<string>,
): boolean {
  const route = event.route;
  const operation = event.operation;
  if (!safeRoute(route) || !safeName(operation)) {
    invalidReasons.add('unsafe_route_or_operation');
    return false;
  }
  if (name !== undefined && !safeName(name)) {
    invalidReasons.add('unsafe_metric_name');
    return false;
  }

  const key = groupKey(route, operation, name);
  let group = groups.get(key);
  if (!group) {
    if (groups.size >= MAX_TIMING_GROUPS) {
      invalidReasons.add('group_cardinality_limit');
      return false;
    }
    group = { route, operation, ...(name ? { name } : {}), durations: [] };
    groups.set(key, group);
  }
  group.durations.push(durationMs);
  return true;
}

function summarizeGroups(
  groups: Map<string, TimingGroup>,
  minSamples: number,
): TimingGroupSummary[] {
  return [...groups.values()]
    .map(({ durations, ...group }) => ({
      ...group,
      count: durations.length,
      p50Ms: quantile(durations, 0.5),
      p95Ms: quantile(durations, 0.95),
      sufficientSamples: durations.length >= minSamples,
    }))
    .sort((left, right) => (
      left.route.localeCompare(right.route)
      || left.operation.localeCompare(right.operation)
      || (left.name ?? '').localeCompare(right.name ?? '')
    ));
}

function summarizeCoverage(
  groups: Map<string, CoverageGroup>,
  minSamples: number,
): PhaseCoverageSummary[] {
  return [...groups.values()]
    .map(({ ratios, route, operation }) => ({
      route,
      operation,
      count: ratios.length,
      p50Pct: quantile(ratios, 0.5),
      p95Pct: quantile(ratios, 0.95),
      atLeast95Pct: rounded(
        (ratios.filter((ratio) => ratio >= 95).length / ratios.length) * 100,
      ),
      sufficientSamples: ratios.length >= minSamples,
    }))
    .sort((left, right) => (
      left.route.localeCompare(right.route)
      || left.operation.localeCompare(right.operation)
    ));
}

function readOperationCoverage(
  event: TimingEvent,
  durationMs: number,
): { ratioPct: number } | { reason: string } {
  const attributedDurationMs = event.attributedDurationMs;
  if (typeof attributedDurationMs !== 'number' || Number.isNaN(attributedDurationMs)) {
    return { reason: 'missing_operation_coverage' };
  }
  if (!Number.isFinite(attributedDurationMs)) {
    return { reason: 'nonfinite_operation_coverage' };
  }
  if (attributedDurationMs < 0) {
    return { reason: 'negative_operation_coverage' };
  }
  if (attributedDurationMs > durationMs + COVERAGE_ROUNDING_TOLERANCE_MS) {
    return { reason: 'operation_coverage_exceeds_duration' };
  }
  const boundedDurationMs = Math.min(durationMs, attributedDurationMs);
  return {
    ratioPct: durationMs === 0 ? 100 : (boundedDurationMs / durationMs) * 100,
  };
}

export function summarizeServerTimingJsonl(
  input: string,
  options: SummarizeOptions = {},
): ServerTimingSummary {
  const minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES;
  if (!Number.isInteger(minSamples) || minSamples < 1 || minSamples > 10_000) {
    throw new RangeError('minSamples must be an integer between 1 and 10000');
  }

  const operations = new Map<string, TimingGroup>();
  const phases = new Map<string, TimingGroup>();
  const queries = new Map<string, TimingGroup>();
  const phaseCoverage = new Map<string, CoverageGroup>();
  const invalidReasons = new Set<string>();
  let parsedLineCount = 0;
  let validSampleCount = 0;
  let invalidLineCount = 0;
  let ignoredEventCount = 0;
  let coverageSampleCount = 0;
  let coverageInvalidCount = 0;
  const coverageInvalidReasons = new Set<string>();

  for (const line of input.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    parsedLineCount += 1;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      invalidLineCount += 1;
      invalidReasons.add('invalid_json');
      continue;
    }
    if (!isRecord(event) || typeof event.event !== 'string') {
      invalidLineCount += 1;
      invalidReasons.add('invalid_event_shape');
      continue;
    }

    const eventName = event.event;
    if (
      eventName !== 'server_operation_timing'
      && eventName !== 'server_phase_timing'
      && eventName !== 'server_query_timing'
    ) {
      ignoredEventCount += 1;
      continue;
    }

    const durationMs = readDuration(event);
    if (durationMs === null) {
      invalidLineCount += 1;
      invalidReasons.add('invalid_duration');
      continue;
    }

    let accepted = false;
    if (eventName === 'server_operation_timing') {
      accepted = addSample(operations, event, undefined, durationMs, invalidReasons);
      if (accepted) {
        const coverage = readOperationCoverage(event, durationMs);
        if ('reason' in coverage) {
          coverageInvalidCount += 1;
          coverageInvalidReasons.add(coverage.reason);
        } else if (safeRoute(event.route) && safeName(event.operation)) {
          coverageSampleCount += 1;
          const key = groupKey(event.route, event.operation);
          const group = phaseCoverage.get(key) ?? {
            route: event.route,
            operation: event.operation,
            ratios: [],
          };
          group.ratios.push(coverage.ratioPct);
          phaseCoverage.set(key, group);
        }
      }
    } else if (eventName === 'server_phase_timing') {
      if (typeof event.phase !== 'string' || !KNOWN_PHASES.has(event.phase)) {
        invalidLineCount += 1;
        invalidReasons.add('unknown_phase');
        continue;
      }
      accepted = addSample(phases, event, event.phase, durationMs, invalidReasons);
    } else {
      if (typeof event.name !== 'string') {
        invalidLineCount += 1;
        invalidReasons.add('missing_metric_name');
        continue;
      }
      accepted = addSample(queries, event, event.name, durationMs, invalidReasons);
    }

    if (accepted) validSampleCount += 1;
    else invalidLineCount += 1;
  }

  return {
    schemaVersion: 1,
    minSamples,
    parsedLineCount,
    validSampleCount,
    invalidLineCount,
    ignoredEventCount,
    invalidReasons: [...invalidReasons].sort(),
    coverageSampleCount,
    coverageInvalidCount,
    coverageInvalidReasons: [...coverageInvalidReasons].sort(),
    operations: summarizeGroups(operations, minSamples),
    phases: summarizeGroups(phases, minSamples),
    queries: summarizeGroups(queries, minSamples),
    phaseCoverage: summarizeCoverage(phaseCoverage, minSamples),
  };
}

export function isServerTimingCoverageGateSatisfied(summary: ServerTimingSummary): boolean {
  return summary.invalidLineCount === 0
    && summary.coverageInvalidCount === 0
    && summary.phaseCoverage.length > 0
    && summary.phaseCoverage.every((group) => (
      group.sufficientSamples && group.atLeast95Pct >= 95
    ));
}

async function readInput(filePath?: string): Promise<string> {
  if (filePath) return readFile(path.resolve(filePath), 'utf8');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function parseCliArgs(argv: string[]): { filePath?: string; minSamples?: number; gate: boolean } {
  let filePath: string | undefined;
  let minSamples: number | undefined;
  let gate = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--file') {
      filePath = argv[index + 1];
      if (!filePath) throw new Error('--file requires a path');
      index += 1;
    } else if (argument === '--min-samples') {
      const raw = argv[index + 1];
      if (!raw) throw new Error('--min-samples requires an integer');
      minSamples = Number(raw);
      index += 1;
    } else if (argument === '--gate') {
      gate = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return { filePath, minSamples, gate };
}

async function main(): Promise<void> {
  const { filePath, minSamples, gate } = parseCliArgs(process.argv.slice(2));
  const summary = summarizeServerTimingJsonl(await readInput(filePath), { minSamples });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.invalidLineCount > 0 || (gate && !isServerTimingCoverageGateSatisfied(summary))) {
    process.exitCode = 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
