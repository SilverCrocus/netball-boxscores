import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

const { cacheControls } = vi.hoisted(() => ({
  cacheControls: {
    hitGate: null as Deferred | null,
    onHit: null as (() => void) | null,
    rejectBeforeLoader: null as Error | null,
  },
}));

vi.mock('next/cache', () => ({
  unstable_cache: (loader: (...args: unknown[]) => Promise<unknown>) => {
    const values = new Map<string, unknown>();
    return async (...args: unknown[]) => {
      if (cacheControls.rejectBeforeLoader) {
        const error = cacheControls.rejectBeforeLoader;
        cacheControls.rejectBeforeLoader = null;
        throw error;
      }
      const key = JSON.stringify(args);
      if (!values.has(key)) {
        const value = await loader(...args);
        values.set(key, value);
        return value;
      }
      if (cacheControls.hitGate) {
        cacheControls.onHit?.();
        await cacheControls.hitGate.promise;
      }
      return values.get(key);
    };
  },
}));

import {
  measureServerOperation,
  timedQuery,
  trackedUnstableCache,
} from '@/lib/server-timing';

describe('server timing instrumentation', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cacheControls.hitGate = null;
    cacheControls.onHit = null;
    cacheControls.rejectBeforeLoader = null;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('logs route-level query totals and cache metadata without timing assertions', async () => {
    await measureServerOperation('/standings', 'standings-page', async () => {
      await timedQuery('standings_rows', async () => 'rows');
    });

    const events = infoSpy.mock.calls
      .map((call: unknown[]) => JSON.parse(String(call[0])) as Record<string, unknown>);
    const operation = events.find((event: Record<string, unknown>) => event.event === 'server_operation_timing');

    expect(operation).toMatchObject({
      event: 'server_operation_timing',
      route: '/standings',
      operation: 'standings-page',
      queryCount: 1,
      cache: {},
    });
    expect(operation?.durationMs).toEqual(expect.any(Number));
    expect(operation?.queryDurationMs).toEqual(expect.any(Number));
    expect(operation).not.toHaveProperty('url');
  });

  it('records cache misses and hits using stable cache names only', async () => {
    const cached = trackedUnstableCache(
      'standings',
      async () => ({ value: 'safe' }),
      ['standings-test-v1'],
      { revalidate: 60, tags: ['standings'] },
    );

    await measureServerOperation('/standings', 'first', () => cached());
    await measureServerOperation('/standings', 'second', () => cached());

    const operations = infoSpy.mock.calls
      .map((call: unknown[]) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .filter((event: Record<string, unknown>) => event.event === 'server_operation_timing');
    expect(operations.map((event: Record<string, unknown>) => event.cache)).toEqual([
      { standings: 'miss' },
      { standings: 'hit' },
    ]);
    expect(
      infoSpy.mock.calls
        .map((call: unknown[]) => JSON.parse(String(call[0])) as Record<string, unknown>)
        .filter((event: Record<string, unknown>) => event.event === 'server_cache_timing')
        .map((event: Record<string, unknown>) => ({
          route: event.route,
          operation: event.operation,
          name: event.name,
          status: event.status,
        })),
    ).toEqual([
      { route: '/standings', operation: 'first', name: 'standings', status: 'miss' },
      { route: '/standings', operation: 'second', name: 'standings', status: 'hit' },
    ]);
    expect(infoSpy.mock.calls.flat().join(' ')).not.toContain('safe');
  });

  it('records a cache rejection as unknown when the loader fails without hiding the error', async () => {
    const cached = trackedUnstableCache(
      'competition-navigation-directory',
      async () => {
        throw new Error('database unavailable');
      },
      ['competition-navigation-directory-failure-v1'],
      { revalidate: 180, tags: ['competition-navigation'] },
    );

    await expect(
      measureServerOperation('/','competition-navigation', () => cached()),
    ).rejects.toThrow('database unavailable');

    const events = infoSpy.mock.calls
      .map((call: unknown[]) => JSON.parse(String(call[0])) as Record<string, unknown>);
    expect(events).toContainEqual(expect.objectContaining({
      event: 'server_cache_timing',
      route: '/',
      operation: 'competition-navigation',
      name: 'competition-navigation-directory',
      status: 'unknown',
    }));
    expect(events).toContainEqual(expect.objectContaining({
      event: 'server_operation_timing',
      route: '/',
      operation: 'competition-navigation',
      cache: {},
    }));
  });

  it('records a cache-layer rejection as unknown without hiding the error', async () => {
    let loaderRan = false;
    const cached = trackedUnstableCache(
      'competition-navigation-directory-rejected',
      async () => {
        loaderRan = true;
        return { value: 'must-not-run' };
      },
      ['competition-navigation-directory-rejected-v1'],
      { revalidate: 180, tags: ['competition-navigation'] },
    );
    cacheControls.rejectBeforeLoader = new Error('cache storage unavailable');

    await expect(
      measureServerOperation('/', 'competition-navigation-rejected', () => cached()),
    ).rejects.toThrow('cache storage unavailable');

    expect(loaderRan).toBe(false);
    const events = infoSpy.mock.calls
      .map((call: unknown[]) => JSON.parse(String(call[0])) as Record<string, unknown>);
    expect(events).toContainEqual(expect.objectContaining({
      event: 'server_cache_timing',
      route: '/',
      operation: 'competition-navigation-rejected',
      name: 'competition-navigation-directory-rejected',
      status: 'unknown',
    }));
    expect(events).toContainEqual(expect.objectContaining({
      event: 'server_operation_timing',
      route: '/',
      operation: 'competition-navigation-rejected',
      cache: {},
    }));
  });

  it('keeps overlapping keyed cache attribution request-local', async () => {
    const makeDeferred = (): Deferred => {
      let resolve!: () => void;
      const promise = new Promise<void>((nextResolve) => {
        resolve = nextResolve;
      });
      return { promise, resolve };
    };
    const missStarted = makeDeferred();
    const releaseMiss = makeDeferred();
    const hitStarted = makeDeferred();
    const releaseHit = makeDeferred();
    const cached = trackedUnstableCache(
      'standings',
      async (key: string) => {
        if (key === 'miss-key') {
          missStarted.resolve();
          await releaseMiss.promise;
        }
        return key;
      },
      ['standings-concurrency-v1'],
      { revalidate: 60, tags: ['standings'] },
    );

    await measureServerOperation('/standings', 'seed', () => cached('hit-key'));

    cacheControls.hitGate = releaseHit;
    cacheControls.onHit = () => hitStarted.resolve();
    const hit = measureServerOperation('/standings', 'overlapping-hit', () => cached('hit-key'));
    await hitStarted.promise;

    const miss = measureServerOperation('/standings', 'overlapping-miss', () => cached('miss-key'));
    await missStarted.promise;
    releaseMiss.resolve();
    await miss;
    releaseHit.resolve();
    await hit;

    const operations = infoSpy.mock.calls
      .map((call: unknown[]) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .filter((event: Record<string, unknown>) => event.event === 'server_operation_timing');
    expect(operations.find((event: Record<string, unknown>) => event.operation === 'overlapping-hit')?.cache).toEqual({
      standings: 'hit',
    });
    expect(operations.find((event: Record<string, unknown>) => event.operation === 'overlapping-miss')?.cache).toEqual({
      standings: 'miss',
    });
  });

  it('attributes overlapping same-name hit and miss calls independently in one operation', async () => {
    const makeDeferred = (): Deferred => {
      let resolve!: () => void;
      const promise = new Promise<void>((nextResolve) => {
        resolve = nextResolve;
      });
      return { promise, resolve };
    };
    const missStarted = makeDeferred();
    const releaseMiss = makeDeferred();
    const hitStarted = makeDeferred();
    const releaseHit = makeDeferred();
    const cached = trackedUnstableCache(
      'same-operation-standings',
      async (key: string) => {
        if (key === 'miss-key') {
          missStarted.resolve();
          await releaseMiss.promise;
        }
        return key;
      },
      ['same-operation-standings-v1'],
      { revalidate: 60, tags: ['standings'] },
    );

    await cached('hit-key');
    cacheControls.hitGate = releaseHit;
    cacheControls.onHit = () => hitStarted.resolve();

    await measureServerOperation('/standings', 'same-operation', async () => {
      const hit = cached('hit-key');
      await hitStarted.promise;
      const miss = cached('miss-key');
      await missStarted.promise;
      releaseMiss.resolve();
      await miss;
      releaseHit.resolve();
      await hit;
    });

    const statuses = infoSpy.mock.calls
      .map((call: unknown[]) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .filter((event: Record<string, unknown>) =>
        event.event === 'server_cache_timing'
        && event.operation === 'same-operation'
        && event.name === 'same-operation-standings',
      )
      .map((event: Record<string, unknown>) => event.status)
      .sort();
    expect(statuses).toEqual(['hit', 'miss']);
  });
});
