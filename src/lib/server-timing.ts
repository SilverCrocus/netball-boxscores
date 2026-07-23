import { unstable_cache } from 'next/cache';

export type CacheStatus = 'hit' | 'miss';

export const SERVER_PHASE_NAMES = [
  'live-active-state',
  'live-fallback-competition',
  'live-fallback-candidates',
  'live-fallback-access-policy',
] as const;

export type ServerPhaseName = typeof SERVER_PHASE_NAMES[number];

export interface CacheSnapshotMeasurement {
  rowCount: number;
  resultCount: number;
  serializedBytes: number;
  rssBeforeBytes: number | null;
  rssAfterBytes: number | null;
  rssDeltaBytes: number | null;
  heapUsedBeforeBytes: number | null;
  heapUsedAfterBytes: number | null;
  heapUsedDeltaBytes: number | null;
}

interface ServerTimingContext {
  route: string;
  operation: string;
  startedAt: number;
  queryCount: number;
  queryDurationMs: number;
  connectionWaitMs: number;
  cache: Record<string, CacheStatus>;
  phases: Partial<Record<ServerPhaseName, number>>;
  phaseIntervals: Array<{ startedAt: number; endedAt: number }>;
}

interface CacheInvocationContext {
  loaderExecuted: boolean;
}

interface AsyncLocalStorageLike<Store> {
  run<T>(store: Store, callback: () => Promise<T>): Promise<T>;
  getStore(): Store | undefined;
}

interface NodeProcessLike {
  getBuiltinModule?: (moduleName: string) => unknown;
}

interface AsyncHooksModule {
  AsyncLocalStorage: new () => AsyncLocalStorageLike<unknown>;
}

const TIMING_CONTEXT_KEY = Symbol.for('centrepass.server-timing.context');
const CACHE_INVOCATION_CONTEXT_KEY = Symbol.for('centrepass.server-timing.cache-invocation');

/**
 * This module is imported by shared policy helpers that can be reached from
 * client bundles. Resolve Node's request context lazily so those bundles do
 * not receive a node:async_hooks external while server renders still get
 * request-local counters on the supported Node runtime.
 */
function createAsyncLocalStorage<Store>(key: symbol): AsyncLocalStorageLike<Store> | null {
  const globalState = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const existing = globalState[key];
  if (existing) return existing as AsyncLocalStorageLike<Store>;

  const nodeProcess = (globalThis as typeof globalThis & { process?: NodeProcessLike }).process;
  if (typeof nodeProcess?.getBuiltinModule !== 'function') return null;
  try {
    const asyncHooks = nodeProcess.getBuiltinModule('node:async_hooks') as AsyncHooksModule;
    const context = new asyncHooks.AsyncLocalStorage();
    globalState[key] = context;
    return context as AsyncLocalStorageLike<Store>;
  } catch {
    return null;
  }
}

const timingContext = createAsyncLocalStorage<ServerTimingContext>(TIMING_CONTEXT_KEY);
const cacheInvocationContext = createAsyncLocalStorage<CacheInvocationContext>(CACHE_INVOCATION_CONTEXT_KEY);

function roundedDuration(value: number): number {
  return Math.round(value * 10) / 10;
}

function phaseCoverage(
  context: ServerTimingContext,
  durationMs: number,
): { attributedDurationMs: number; overlapDurationMs: number } {
  if (durationMs <= 0 || context.phaseIntervals.length === 0) {
    return { attributedDurationMs: 0, overlapDurationMs: 0 };
  }

  const operationEnd = context.startedAt + durationMs;
  const intervals = context.phaseIntervals
    .map(({ startedAt, endedAt }) => ({
      startedAt: Math.max(context.startedAt, startedAt),
      endedAt: Math.min(operationEnd, endedAt),
    }))
    .filter(({ startedAt, endedAt }) => endedAt >= startedAt)
    .sort((left, right) => (
      left.startedAt - right.startedAt || left.endedAt - right.endedAt
    ));

  let totalIntervalMs = 0;
  let unionMs = 0;
  let unionStart = 0;
  let unionEnd = 0;

  for (const interval of intervals) {
    totalIntervalMs += interval.endedAt - interval.startedAt;
    if (unionEnd <= unionStart) {
      unionStart = interval.startedAt;
      unionEnd = interval.endedAt;
    } else if (interval.startedAt <= unionEnd) {
      unionEnd = Math.max(unionEnd, interval.endedAt);
    } else {
      unionMs += unionEnd - unionStart;
      unionStart = interval.startedAt;
      unionEnd = interval.endedAt;
    }
  }
  if (unionEnd > unionStart) unionMs += unionEnd - unionStart;

  return {
    attributedDurationMs: Math.min(durationMs, Math.max(0, unionMs)),
    overlapDurationMs: Math.min(
      durationMs,
      Math.max(0, totalIntervalMs - unionMs),
    ),
  };
}

function productionLog(payload: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'production') {
    console.info(JSON.stringify(payload));
  }
}

/**
 * Measures one server-rendered route operation. The context is deliberately
 * request-local so concurrent renders cannot mix query or cache statistics.
 */
export async function measureServerOperation<T>(
  route: string,
  operation: string,
  handler: () => Promise<T>,
): Promise<T> {
  const context: ServerTimingContext = {
    route,
    operation,
    startedAt: performance.now(),
    queryCount: 0,
    queryDurationMs: 0,
    connectionWaitMs: 0,
    cache: {},
    phases: {},
    phaseIntervals: [],
  };

  const run = async () => {
    try {
      return await handler();
    } finally {
      const durationMs = Math.max(0, performance.now() - context.startedAt);
      const coverage = phaseCoverage(context, durationMs);
      const roundedTotalMs = roundedDuration(durationMs);
      productionLog({
        event: 'server_operation_timing',
        route,
        operation,
        durationMs: roundedTotalMs,
        attributedDurationMs: Math.min(
          roundedTotalMs,
          Math.max(0, roundedDuration(coverage.attributedDurationMs)),
        ),
        phaseOverlapDurationMs: Math.min(
          roundedTotalMs,
          Math.max(0, roundedDuration(coverage.overlapDurationMs)),
        ),
        queryCount: context.queryCount,
        queryDurationMs: roundedDuration(context.queryDurationMs),
        connectionWaitMs: roundedDuration(context.connectionWaitMs),
        cache: context.cache,
        phases: Object.fromEntries(
          Object.entries(context.phases).map(([phase, durationMs]) => [
            phase,
            roundedDuration(durationMs ?? 0),
          ]),
        ),
      });
    }
  };

  return timingContext ? timingContext.run(context, run) : run();
}

/**
 * Measures one named wall-clock phase inside a route operation. Phase events
 * are intentionally separate from query totals: independent phases can
 * overlap, so their durations must not be mistaken for critical-path time.
 */
export async function measureServerPhase<T>(
  phase: ServerPhaseName,
  handler: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await handler();
  } finally {
    const endedAt = performance.now();
    const durationMs = endedAt - startedAt;
    const context = timingContext?.getStore();
    if (context) {
      context.phases[phase] = (context.phases[phase] ?? 0) + durationMs;
      context.phaseIntervals.push({ startedAt, endedAt });
    }
    productionLog({
      event: 'server_phase_timing',
      route: context?.route ?? 'unknown',
      operation: context?.operation ?? phase,
      phase,
      durationMs: roundedDuration(durationMs),
    });
  }
}

/** Records a cache result on the current route operation without logging keys or arguments. */
export function recordCacheResult(name: string, status: CacheStatus): void {
  const context = timingContext?.getStore();
  if (context) context.cache[name] = status;
}

/** Records bounded snapshot-size and process-memory metadata without payloads or keys. */
export function recordCacheSnapshotMeasurement(
  name: string,
  measurement: CacheSnapshotMeasurement,
): void {
  const context = timingContext?.getStore();
  productionLog({
    event: 'server_cache_snapshot_measurement',
    route: context?.route ?? 'unknown',
    operation: context?.operation ?? name,
    name,
    ...measurement,
  });
}

/**
 * Wraps Next's supported data cache with production-safe hit/miss metadata.
 * A miss is marked in an invocation-local async context that only the cache
 * loader for this wrapper call can see. Rejections remain unknown because a
 * cache-layer failure may happen before the loader is reached.
 */
export function trackedUnstableCache<Args extends unknown[], Result>(
  name: string,
  loader: (...args: Args) => Promise<Result>,
  keyParts: string[],
  options: Parameters<typeof unstable_cache>[2],
): (...args: Args) => Promise<Result> {
  const cachedLoader = unstable_cache(
    async (...args: Args) => {
      const invocation = cacheInvocationContext?.getStore();
      if (invocation) invocation.loaderExecuted = true;
      return loader(...args);
    },
    keyParts,
    options,
  );

  return async (...args: Args) => {
    const context = timingContext?.getStore();
    let status: CacheStatus | 'unknown' = 'unknown';
    try {
      let result: Result;
      if (context && cacheInvocationContext) {
        const invocation: CacheInvocationContext = { loaderExecuted: false };
        result = await cacheInvocationContext.run(
          invocation,
          () => cachedLoader(...args),
        );
        status = invocation.loaderExecuted ? 'miss' : 'hit';
      } else {
        result = await cachedLoader(...args);
      }
      return result;
    } finally {
      if (context && status !== 'unknown') context.cache[name] = status;
      productionLog({
        event: 'server_cache_timing',
        route: context?.route ?? 'unknown',
        operation: context?.operation ?? name,
        name,
        status,
      });
    }
  };
}

/** Measures an explicitly acquired database connection or boundary probe. */
export async function timedConnection<T>(
  name: string,
  connection: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await connection();
  } finally {
    const durationMs = performance.now() - startedAt;
    const context = timingContext?.getStore();
    if (context) context.connectionWaitMs += durationMs;
    productionLog({
      event: 'server_connection_timing',
      route: context?.route ?? 'unknown',
      operation: context?.operation ?? name,
      name,
      durationMs: roundedDuration(durationMs),
    });
  }
}

export async function timedQuery<T>(name: string, query: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();

  try {
    return await query();
  } finally {
    const durationMs = performance.now() - startedAt;
    const context = timingContext?.getStore();
    if (context) {
      context.queryCount += 1;
      context.queryDurationMs += durationMs;
    }
    productionLog({
      event: 'server_query_timing',
      route: context?.route ?? 'unknown',
      operation: context?.operation ?? name,
      name,
      durationMs: roundedDuration(durationMs),
    });
  }
}
