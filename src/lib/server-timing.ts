import { unstable_cache } from 'next/cache';

export type CacheStatus = 'hit' | 'miss';

interface ServerTimingContext {
  route: string;
  operation: string;
  startedAt: number;
  queryCount: number;
  queryDurationMs: number;
  connectionWaitMs: number;
  cache: Record<string, CacheStatus>;
  cacheMisses: Map<string, number>;
}

interface AsyncLocalStorageLike {
  run<T>(store: ServerTimingContext, callback: () => Promise<T>): Promise<T>;
  getStore(): ServerTimingContext | undefined;
}

interface NodeProcessLike {
  getBuiltinModule?: (moduleName: string) => unknown;
}

interface AsyncHooksModule {
  AsyncLocalStorage: new () => AsyncLocalStorageLike;
}

const TIMING_CONTEXT_KEY = Symbol.for('centrepass.server-timing.context');

/**
 * This module is imported by shared policy helpers that can be reached from
 * client bundles. Resolve Node's request context lazily so those bundles do
 * not receive a node:async_hooks external while server renders still get
 * request-local counters on the supported Node runtime.
 */
function createTimingContext(): AsyncLocalStorageLike | null {
  const globalState = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const existing = globalState[TIMING_CONTEXT_KEY];
  if (existing) return existing as AsyncLocalStorageLike;

  const nodeProcess = (globalThis as typeof globalThis & { process?: NodeProcessLike }).process;
  if (typeof nodeProcess?.getBuiltinModule !== 'function') return null;
  try {
    const asyncHooks = nodeProcess.getBuiltinModule('node:async_hooks') as AsyncHooksModule;
    const context = new asyncHooks.AsyncLocalStorage();
    globalState[TIMING_CONTEXT_KEY] = context;
    return context;
  } catch {
    return null;
  }
}

const timingContext = createTimingContext();

function roundedDuration(value: number): number {
  return Math.round(value * 10) / 10;
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
    cacheMisses: new Map(),
  };

  const run = async () => {
    try {
      return await handler();
    } finally {
      productionLog({
        event: 'server_operation_timing',
        route,
        operation,
        durationMs: roundedDuration(performance.now() - context.startedAt),
        queryCount: context.queryCount,
        queryDurationMs: roundedDuration(context.queryDurationMs),
        connectionWaitMs: roundedDuration(context.connectionWaitMs),
        cache: context.cache,
      });
    }
  };

  return timingContext ? timingContext.run(context, run) : run();
}

/** Records a cache result on the current route operation without logging keys or arguments. */
export function recordCacheResult(name: string, status: CacheStatus): void {
  const context = timingContext?.getStore();
  if (context) context.cache[name] = status;
}

/**
 * Wraps Next's supported data cache with production-safe hit/miss metadata.
 * A miss is marked in the request context that actually executes the loader,
 * avoiding shared mutable counters across concurrent cache keys or requests.
 */
export function trackedUnstableCache<Args extends unknown[], Result>(
  name: string,
  loader: (...args: Args) => Promise<Result>,
  keyParts: string[],
  options: Parameters<typeof unstable_cache>[2],
): (...args: Args) => Promise<Result> {
  const cachedLoader = unstable_cache(
    async (...args: Args) => {
      const context = timingContext?.getStore();
      if (context) {
        context.cacheMisses.set(name, (context.cacheMisses.get(name) ?? 0) + 1);
      }
      return loader(...args);
    },
    keyParts,
    options,
  );

  return async (...args: Args) => {
    const context = timingContext?.getStore();
    const cacheMissesBefore = context?.cacheMisses.get(name) ?? 0;
    try {
      return await cachedLoader(...args);
    } finally {
      const status: CacheStatus | 'unknown' = context
        ? ((context.cacheMisses.get(name) ?? 0) > cacheMissesBefore ? 'miss' : 'hit')
        : 'unknown';
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
