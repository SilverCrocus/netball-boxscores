import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache: (loader: (...args: unknown[]) => Promise<unknown>) => {
    let hasValue = false;
    let value: unknown;
    return async (...args: unknown[]) => {
      if (!hasValue) {
        value = await loader(...args);
        hasValue = true;
      }
      return value;
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

  it('records a cache miss when the loader fails without hiding the error', async () => {
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
      status: 'miss',
    }));
    expect(events).toContainEqual(expect.objectContaining({
      event: 'server_operation_timing',
      route: '/',
      operation: 'competition-navigation',
      cache: { 'competition-navigation-directory': 'miss' },
    }));
  });
});
