import { describe, expect, it } from 'vitest';
import {
  getWorkerStartupDecision,
  type WorkerStartupEnvironment,
} from '@/lib/worker-startup';

function decide(overrides: WorkerStartupEnvironment = {}) {
  return getWorkerStartupDecision({
    ...overrides,
    NODE_ENV: overrides.NODE_ENV ?? 'development',
  });
}

describe('worker startup decision', () => {
  it('keeps the worker disabled by default outside production', () => {
    expect(decide()).toMatchObject({
      state: 'disabled',
      shouldStart: false,
      required: false,
    });
  });

  it('treats a disabled production worker as required but unavailable', () => {
    expect(decide({ NODE_ENV: 'production' })).toMatchObject({
      state: 'disabled',
      shouldStart: false,
      required: true,
    });
  });

  it('starts an explicitly enabled production worker', () => {
    expect(decide({
      NODE_ENV: 'production',
      WORKER_ENABLED: 'true',
      DATABASE_ENVIRONMENT: 'production',
    })).toMatchObject({
      state: 'enabled',
      shouldStart: true,
      required: true,
      databaseEnvironment: 'production',
    });
  });

  it('requires a database marker before enabling polling', () => {
    expect(decide({ WORKER_ENABLED: 'true' })).toMatchObject({
      state: 'blocked',
      shouldStart: false,
      databaseEnvironment: 'unspecified',
    });
  });

  it('blocks a non-production worker from a production database', () => {
    expect(decide({
      WORKER_ENABLED: 'true',
      DATABASE_ENVIRONMENT: 'production',
    })).toMatchObject({
      state: 'blocked',
      shouldStart: false,
      required: true,
    });
  });

  it('allows the production-database exception only with the explicit acknowledgement', () => {
    expect(decide({
      WORKER_ENABLED: 'true',
      DATABASE_ENVIRONMENT: 'production',
      ALLOW_SHARED_PRODUCTION_DB_WRITES: 'true',
    })).toMatchObject({
      state: 'enabled',
      shouldStart: true,
      databaseEnvironment: 'production',
    });
  });

  it('does not treat a truthy-looking value as explicit enablement', () => {
    expect(decide({
      WORKER_ENABLED: 'TRUE',
      DATABASE_ENVIRONMENT: 'local',
    })).toMatchObject({
      state: 'disabled',
      shouldStart: false,
    });
  });
});
