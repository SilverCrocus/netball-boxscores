import { describe, expect, it } from 'vitest';
import {
  assertLocalMemoryStressEnvironment,
  buildMemoryStressRoutes,
  buildMemoryStressWave,
  LocalMemoryStressBlockedError,
  MEMORY_HARD_RSS_LIMIT_BYTES,
  MEMORY_PREFERRED_RSS_LIMIT_BYTES,
  parseMemoryStressOptions,
  summarizeMemorySamples,
} from '../../../scripts/stress-phase2-memory';

const localEnvironment = {
  DATABASE_ENVIRONMENT: 'local',
  WORKER_ENABLED: 'false',
  DATABASE_URL: 'postgresql://postgres:ci@127.0.0.1:5432/centrepass',
  DIRECT_URL: 'postgresql://postgres:ci@127.0.0.1:5432/centrepass',
  ANALYTICS_DATABASE_URL: 'postgresql://centrepass_analytics:ci@127.0.0.1:5432/centrepass',
};

describe('Phase 2 memory stress harness', () => {
  it('accepts only an explicitly local loopback database environment', () => {
    expect(() => assertLocalMemoryStressEnvironment(localEnvironment)).not.toThrow();
    expect(() => assertLocalMemoryStressEnvironment({
      ...localEnvironment,
      DATABASE_ENVIRONMENT: 'staging',
    })).toThrow(LocalMemoryStressBlockedError);
    expect(() => assertLocalMemoryStressEnvironment({
      ...localEnvironment,
      DATABASE_URL: 'postgresql://postgres:ci@db.example/centrepass',
    })).toThrow(LocalMemoryStressBlockedError);
  });

  it('uses bounded options and refuses epoch rotations beyond the available waves', () => {
    expect(parseMemoryStressOptions([
      '--concurrency=6',
      '--waves=4',
      '--epoch-rotations=3',
      '--request-timeout-ms=20000',
      '--representative-data-confirmed',
    ])).toEqual({
      concurrency: 6,
      waves: 4,
      epochRotations: 3,
      requestTimeoutMs: 20_000,
      representativeDataConfirmed: true,
    });
    expect(() => parseMemoryStressOptions(['--concurrency=17'])).toThrow();
    expect(() => parseMemoryStressOptions(['--waves=2', '--epoch-rotations=2'])).toThrow();
  });

  it('builds identical requests per route for app-level cold-miss coalescing', () => {
    const routes = buildMemoryStressRoutes();
    const wave = buildMemoryStressWave(4);
    expect(routes.map((route) => route.name)).toEqual(['rankings', 'records', 'live', 'standings']);
    expect(wave).toHaveLength(16);
    for (const route of routes) {
      expect(new Set(wave.filter((item) => item.name === route.name).map((item) => item.path)).size).toBe(1);
    }
  });

  it('reports the child RSS and heap peaks against both release targets', () => {
    const summary = summarizeMemorySamples([
      {
        childRssBytes: MEMORY_PREFERRED_RSS_LIMIT_BYTES - 1,
        childHeapUsedBytes: 100,
        harnessRssBytes: 200,
        harnessHeapUsedBytes: 100,
      },
      {
        childRssBytes: MEMORY_HARD_RSS_LIMIT_BYTES - 1,
        childHeapUsedBytes: 200,
        harnessRssBytes: 300,
        harnessHeapUsedBytes: 150,
      },
    ], { matches: 38, players: 12, teams: 12 }, parseMemoryStressOptions([]), 0, 0, 0, false);
    expect(summary.peakChildRssBytes).toBe(MEMORY_HARD_RSS_LIMIT_BYTES - 1);
    expect(summary.peakChildHeapUsedBytes).toBe(200);
    expect(summary.hardRssLimitPassed).toBe(true);
    expect(summary.preferredRssTargetPassed).toBe(false);
  });
});
