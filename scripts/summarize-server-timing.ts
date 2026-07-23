import { createReadStream } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SERVER_PHASE_NAMES } from '@/lib/server-timing';

export const DEFAULT_MIN_SAMPLES = 20;
export const MAX_TIMING_GROUPS = 64;
export const MAX_TIMING_INPUT_BYTES = 16 * 1024 * 1024;
export const MAX_TIMING_INPUT_LINES = 100_000;
export const MAX_TIMING_LINE_BYTES = 1 * 1024 * 1024;
export const MAX_TIMING_SAMPLES_PER_GROUP = 10_000;
export const MAX_TIMING_TOTAL_SAMPLES = 100_000;

const MAX_DURATION_MS = 300_000;
const COVERAGE_ROUNDING_TOLERANCE_MS = 0.2;
const STABLE_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const STABLE_ROUTE = /^\/[A-Za-z0-9/_\-[\]]{0,63}$/;
const KNOWN_PHASES = new Set<string>(SERVER_PHASE_NAMES);

type TimingEvent = Record<string, unknown>;
type ServerOperationOutcome = 'success' | 'error';

export class SummarizerLimitError extends Error {
  constructor(
    public readonly code:
    | 'input_byte_limit'
    | 'input_line_limit'
    | 'oversized_line'
    | 'sample_cap_exceeded',
    message: string,
  ) {
    super(message);
    this.name = 'SummarizerLimitError';
  }
}

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
  successSampleCount: number;
  errorSampleCount: number;
  outcomeInvalidCount: number;
  outcomeInvalidReasons: string[];
  invalidLineCount: number;
  ignoredEventCount: number;
  invalidReasons: string[];
  coverageSampleCount: number;
  coverageInvalidCount: number;
  coverageInvalidReasons: string[];
  operations: TimingGroupSummary[];
  successfulOperations: TimingGroupSummary[];
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

export interface SummarizeOptions {
  minSamples?: number;
}

export type TimingInputChunk = Uint8Array | string;

export interface TimingInputSource extends AsyncIterable<TimingInputChunk> {
  destroy?: (error?: Error) => unknown;
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

function validateMinSamples(minSamples: number | undefined): number {
  const resolved = minSamples ?? DEFAULT_MIN_SAMPLES;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > MAX_TIMING_SAMPLES_PER_GROUP) {
    throw new RangeError(`minSamples must be an integer between 1 and ${MAX_TIMING_SAMPLES_PER_GROUP}`);
  }
  return resolved;
}

function readOperationOutcome(
  event: TimingEvent,
): { outcome: ServerOperationOutcome } | { reason: string } {
  if (!Object.prototype.hasOwnProperty.call(event, 'outcome')) {
    return { reason: 'missing_operation_outcome' };
  }
  if (event.outcome === 'success' || event.outcome === 'error') {
    return { outcome: event.outcome };
  }
  return { reason: 'unknown_operation_outcome' };
}

function readOperationCoverage(
  event: TimingEvent,
  durationMs: number,
): { ratioPct: number } | { reason: string } {
  if (durationMs <= 0) {
    return { reason: 'nonpositive_operation_duration' };
  }

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
  return { ratioPct: (boundedDurationMs / durationMs) * 100 };
}

class SummaryAccumulator {
  private readonly operations = new Map<string, TimingGroup>();
  private readonly successfulOperations = new Map<string, TimingGroup>();
  private readonly phases = new Map<string, TimingGroup>();
  private readonly queries = new Map<string, TimingGroup>();
  private readonly phaseCoverage = new Map<string, CoverageGroup>();
  private readonly invalidReasons = new Set<string>();
  private readonly coverageInvalidReasons = new Set<string>();
  private readonly outcomeInvalidReasons = new Set<string>();
  private parsedLineCount = 0;
  private inputLineCount = 0;
  private inputBytes: number;
  private readonly trackInputBytes: boolean;
  private validSampleCount = 0;
  private successSampleCount = 0;
  private errorSampleCount = 0;
  private outcomeInvalidCount = 0;
  private invalidLineCount = 0;
  private ignoredEventCount = 0;
  private coverageSampleCount = 0;
  private coverageInvalidCount = 0;
  private storedSampleCount = 0;

  constructor(
    private readonly minSamples: number,
    prevalidatedInputBytes?: number,
  ) {
    this.inputBytes = prevalidatedInputBytes ?? 0;
    this.trackInputBytes = prevalidatedInputBytes === undefined;
  }

  addLine(line: string): void {
    this.inputLineCount += 1;
    if (this.inputLineCount > MAX_TIMING_INPUT_LINES) {
      throw new SummarizerLimitError(
        'input_line_limit',
        `timing input exceeds the ${MAX_TIMING_INPUT_LINES}-line limit`,
      );
    }

    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (lineBytes > MAX_TIMING_LINE_BYTES) {
      throw new SummarizerLimitError(
        'oversized_line',
        `timing input contains a line over the ${MAX_TIMING_LINE_BYTES}-byte limit`,
      );
    }
    if (this.trackInputBytes) {
      this.inputBytes += lineBytes + 2;
      if (this.inputBytes > MAX_TIMING_INPUT_BYTES) {
        throw new SummarizerLimitError(
          'input_byte_limit',
          `timing input exceeds the ${MAX_TIMING_INPUT_BYTES}-byte limit`,
        );
      }
    }

    if (line.trim() === '') return;
    this.parsedLineCount += 1;

    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      this.invalidLineCount += 1;
      this.invalidReasons.add('invalid_json');
      return;
    }
    if (!isRecord(event) || typeof event.event !== 'string') {
      this.invalidLineCount += 1;
      this.invalidReasons.add('invalid_event_shape');
      return;
    }

    const eventName = event.event;
    if (
      eventName !== 'server_operation_timing'
      && eventName !== 'server_phase_timing'
      && eventName !== 'server_query_timing'
    ) {
      this.ignoredEventCount += 1;
      return;
    }

    const durationMs = readDuration(event);
    if (durationMs === null) {
      this.invalidLineCount += 1;
      this.invalidReasons.add('invalid_duration');
      return;
    }

    if (eventName === 'server_operation_timing') {
      this.addOperation(event, durationMs);
      return;
    }

    if (eventName === 'server_phase_timing') {
      if (typeof event.phase !== 'string' || !KNOWN_PHASES.has(event.phase)) {
        this.invalidLineCount += 1;
        this.invalidReasons.add('unknown_phase');
        return;
      }
      if (this.addSample(this.phases, event, event.phase, durationMs)) {
        this.validSampleCount += 1;
      } else {
        this.invalidLineCount += 1;
      }
      return;
    }

    if (typeof event.name !== 'string') {
      this.invalidLineCount += 1;
      this.invalidReasons.add('missing_metric_name');
      return;
    }
    if (this.addSample(this.queries, event, event.name, durationMs)) {
      this.validSampleCount += 1;
    } else {
      this.invalidLineCount += 1;
    }
  }

  finish(): ServerTimingSummary {
    return {
      schemaVersion: 1,
      minSamples: this.minSamples,
      parsedLineCount: this.parsedLineCount,
      validSampleCount: this.validSampleCount,
      successSampleCount: this.successSampleCount,
      errorSampleCount: this.errorSampleCount,
      outcomeInvalidCount: this.outcomeInvalidCount,
      outcomeInvalidReasons: [...this.outcomeInvalidReasons].sort(),
      invalidLineCount: this.invalidLineCount,
      ignoredEventCount: this.ignoredEventCount,
      invalidReasons: [...this.invalidReasons].sort(),
      coverageSampleCount: this.coverageSampleCount,
      coverageInvalidCount: this.coverageInvalidCount,
      coverageInvalidReasons: [...this.coverageInvalidReasons].sort(),
      operations: summarizeGroups(this.operations, this.minSamples),
      successfulOperations: summarizeGroups(this.successfulOperations, this.minSamples),
      phases: summarizeGroups(this.phases, this.minSamples),
      queries: summarizeGroups(this.queries, this.minSamples),
      phaseCoverage: summarizeCoverage(this.phaseCoverage, this.minSamples),
    };
  }

  private addOperation(event: TimingEvent, durationMs: number): void {
    const accepted = this.addSample(this.operations, event, undefined, durationMs);
    if (!accepted) {
      this.invalidLineCount += 1;
      return;
    }
    this.validSampleCount += 1;

    const outcome = readOperationOutcome(event);
    if ('reason' in outcome) {
      this.outcomeInvalidCount += 1;
      this.outcomeInvalidReasons.add(outcome.reason);
      this.invalidReasons.add(outcome.reason);
      this.invalidLineCount += 1;
      return;
    }

    if (outcome.outcome === 'error') {
      this.errorSampleCount += 1;
      return;
    }

    this.successSampleCount += 1;
    if (!this.addSample(this.successfulOperations, event, undefined, durationMs)) {
      this.invalidLineCount += 1;
      return;
    }

    const coverage = readOperationCoverage(event, durationMs);
    if ('reason' in coverage) {
      this.coverageInvalidCount += 1;
      this.coverageInvalidReasons.add(coverage.reason);
      return;
    }

    if (!this.addCoverageSample(event, coverage.ratioPct)) {
      this.coverageInvalidCount += 1;
      this.coverageInvalidReasons.add('group_cardinality_limit');
      return;
    }
    this.coverageSampleCount += 1;
  }

  private reserveSample(): void {
    if (this.storedSampleCount >= MAX_TIMING_TOTAL_SAMPLES) {
      throw new SummarizerLimitError(
        'sample_cap_exceeded',
        `timing samples exceed the ${MAX_TIMING_TOTAL_SAMPLES}-sample limit`,
      );
    }
    this.storedSampleCount += 1;
  }

  private addSample(
    groups: Map<string, TimingGroup>,
    event: TimingEvent,
    name: string | undefined,
    durationMs: number,
  ): boolean {
    const route = event.route;
    const operation = event.operation;
    if (!safeRoute(route) || !safeName(operation)) {
      this.invalidReasons.add('unsafe_route_or_operation');
      return false;
    }
    if (name !== undefined && !safeName(name)) {
      this.invalidReasons.add('unsafe_metric_name');
      return false;
    }

    const key = groupKey(route, operation, name);
    let group = groups.get(key);
    if (!group) {
      if (groups.size >= MAX_TIMING_GROUPS) {
        this.invalidReasons.add('group_cardinality_limit');
        return false;
      }
      group = { route, operation, ...(name ? { name } : {}), durations: [] };
      groups.set(key, group);
    }
    if (group.durations.length >= MAX_TIMING_SAMPLES_PER_GROUP) {
      throw new SummarizerLimitError(
        'sample_cap_exceeded',
        `a timing group exceeds the ${MAX_TIMING_SAMPLES_PER_GROUP}-sample limit`,
      );
    }
    this.reserveSample();
    group.durations.push(durationMs);
    return true;
  }

  private addCoverageSample(event: TimingEvent, ratioPct: number): boolean {
    const route = event.route;
    const operation = event.operation;
    if (!safeRoute(route) || !safeName(operation)) return false;
    const key = groupKey(route, operation);
    let group = this.phaseCoverage.get(key);
    if (!group) {
      if (this.phaseCoverage.size >= MAX_TIMING_GROUPS) return false;
      group = { route, operation, ratios: [] };
      this.phaseCoverage.set(key, group);
    }
    if (group.ratios.length >= MAX_TIMING_SAMPLES_PER_GROUP) {
      throw new SummarizerLimitError(
        'sample_cap_exceeded',
        `a timing group exceeds the ${MAX_TIMING_SAMPLES_PER_GROUP}-sample limit`,
      );
    }
    this.reserveSample();
    group.ratios.push(ratioPct);
    return true;
  }
}

async function stopTimingInput(
  source: TimingInputSource,
  iterator: AsyncIterator<TimingInputChunk>,
): Promise<void> {
  try {
    source.destroy?.();
  } catch {
    // Preserve the original scanner/stream error.
  }
  try {
    await iterator.return?.();
  } catch {
    // Preserve the original scanner/stream error.
  }
}

/**
 * Scans a JSONL byte stream without allowing an unterminated line to grow
 * beyond its cap. Bytes stay intact until a complete line is available, so
 * UTF-8 sequences split across source chunks are decoded only once.
 */
export async function scanTimingJsonl(
  source: TimingInputSource,
  onLine: (line: string) => void | Promise<void>,
): Promise<void> {
  const iterator = source[Symbol.asyncIterator]();
  const pendingLine = Buffer.allocUnsafe(MAX_TIMING_LINE_BYTES);
  let pendingLineBytes = 0;
  let pendingCarriageReturn = false;
  let totalInputBytes = 0;
  let lineCount = 0;

  const appendByte = (byte: number): void => {
    if (pendingLineBytes >= MAX_TIMING_LINE_BYTES) {
      throw new SummarizerLimitError(
        'oversized_line',
        `timing input contains a line over the ${MAX_TIMING_LINE_BYTES}-byte limit`,
      );
    }
    pendingLine[pendingLineBytes] = byte;
    pendingLineBytes += 1;
  };

  const emitLine = async (): Promise<void> => {
    lineCount += 1;
    if (lineCount > MAX_TIMING_INPUT_LINES) {
      throw new SummarizerLimitError(
        'input_line_limit',
        `timing input exceeds the ${MAX_TIMING_INPUT_LINES}-line limit`,
      );
    }

    const line = pendingLine.subarray(0, pendingLineBytes).toString('utf8');
    pendingLineBytes = 0;
    await onLine(line);
  };

  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) break;

      const chunk = typeof next.value === 'string'
        ? Buffer.from(next.value, 'utf8')
        : Buffer.from(next.value);
      if (chunk.length > MAX_TIMING_INPUT_BYTES - totalInputBytes) {
        throw new SummarizerLimitError(
          'input_byte_limit',
          `timing input exceeds the ${MAX_TIMING_INPUT_BYTES}-byte limit`,
        );
      }
      totalInputBytes += chunk.length;

      for (const byte of chunk) {
        if (pendingCarriageReturn) {
          pendingCarriageReturn = false;
          if (byte === 0x0a) {
            await emitLine();
            continue;
          }
          appendByte(0x0d);
        }

        if (byte === 0x0a) {
          await emitLine();
          continue;
        }

        if (byte === 0x0d) {
          pendingCarriageReturn = true;
          continue;
        }

        appendByte(byte);
      }
    }

    if (pendingCarriageReturn) {
      pendingCarriageReturn = false;
      appendByte(0x0d);
    }
    if (pendingLineBytes > 0) {
      await emitLine();
    }
  } catch (error) {
    await stopTimingInput(source, iterator);
    throw error;
  }
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

function createAccumulator(options: SummarizeOptions, prevalidatedInputBytes?: number): SummaryAccumulator {
  return new SummaryAccumulator(validateMinSamples(options.minSamples), prevalidatedInputBytes);
}

function summarizeLines(
  lines: Iterable<string>,
  options: SummarizeOptions,
  prevalidatedInputBytes?: number,
): ServerTimingSummary {
  const accumulator = createAccumulator(options, prevalidatedInputBytes);
  for (const line of lines) accumulator.addLine(line);
  return accumulator.finish();
}

export function summarizeServerTimingJsonl(
  input: string,
  options: SummarizeOptions = {},
): ServerTimingSummary {
  const inputBytes = Buffer.byteLength(input, 'utf8');
  if (inputBytes > MAX_TIMING_INPUT_BYTES) {
    throw new SummarizerLimitError(
      'input_byte_limit',
      `timing input exceeds the ${MAX_TIMING_INPUT_BYTES}-byte limit`,
    );
  }
  return summarizeLines(input.split(/\r?\n/), options, inputBytes);
}

export async function summarizeServerTimingReadable(
  source: TimingInputSource,
  options: SummarizeOptions = {},
): Promise<ServerTimingSummary> {
  const accumulator = createAccumulator(options, 0);
  await scanTimingJsonl(source, (line) => accumulator.addLine(line));
  return accumulator.finish();
}

export function isServerTimingCoverageGateSatisfied(summary: ServerTimingSummary): boolean {
  return summary.invalidLineCount === 0
    && summary.outcomeInvalidCount === 0
    && summary.successSampleCount >= summary.minSamples
    && summary.coverageInvalidCount === 0
    && summary.successfulOperations.length > 0
    && summary.successfulOperations.every((group) => group.sufficientSamples)
    && summary.phaseCoverage.length > 0
    && summary.phaseCoverage.every((group) => (
      group.sufficientSamples && group.atLeast95Pct >= 95
    ));
}

async function summarizeCliInput(
  filePath: string | undefined,
  options: SummarizeOptions,
): Promise<ServerTimingSummary> {
  const input = filePath
    ? createReadStream(path.resolve(filePath))
    : process.stdin;
  try {
    return await summarizeServerTimingReadable(input, options);
  } finally {
    if (filePath) input.destroy();
  }
}

function parseCliArgs(argv: string[]): {
  filePath?: string;
  minSamples?: number;
  requireCoverage: boolean;
} {
  let filePath: string | undefined;
  let minSamples: number | undefined;
  let requireCoverage = false;
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
    } else if (argument === '--gate' || argument === '--require-coverage') {
      requireCoverage = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return { filePath, minSamples, requireCoverage };
}

async function main(): Promise<void> {
  const { filePath, minSamples, requireCoverage } = parseCliArgs(process.argv.slice(2));
  const summary = await summarizeCliInput(filePath, { minSamples });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.invalidLineCount > 0 || (requireCoverage && !isServerTimingCoverageGateSatisfied(summary))) {
    process.exitCode = 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    if (error instanceof SummarizerLimitError) {
      process.stdout.write(`${JSON.stringify({
        schemaVersion: 1,
        error: { code: error.code, message: error.message },
      })}\n`);
      process.exitCode = 2;
      return;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
