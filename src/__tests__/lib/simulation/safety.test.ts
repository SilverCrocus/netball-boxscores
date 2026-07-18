import { describe, expect, it } from 'vitest';
import {
  assertSimulationDatabaseIsSafe,
  getSimulationDatabaseSafetyDecision,
} from '@/lib/simulation/safety';

describe('simulation database safety', () => {
  it.each(['local', 'development', 'test'])(
    'allows a non-production %s database',
    (databaseEnvironment) => {
      expect(getSimulationDatabaseSafetyDecision({
        NODE_ENV: 'development',
        DATABASE_ENVIRONMENT: databaseEnvironment,
      })).toMatchObject({
        allowed: true,
        databaseEnvironment,
      });
    },
  );

  it.each(['staging', 'production'])(
    'rejects %s even with the shared-write acknowledgement',
    (databaseEnvironment) => {
      expect(getSimulationDatabaseSafetyDecision({
        NODE_ENV: 'development',
        DATABASE_ENVIRONMENT: databaseEnvironment,
        ALLOW_SHARED_PRODUCTION_DB_WRITES: 'true',
      })).toMatchObject({
        allowed: false,
        databaseEnvironment,
      });
    },
  );

  it('rejects a production process even when its database is marked local', () => {
    expect(getSimulationDatabaseSafetyDecision({
      NODE_ENV: 'production',
      DATABASE_ENVIRONMENT: 'local',
    }).allowed).toBe(false);
  });

  it('rejects an unspecified database environment', () => {
    expect(() => assertSimulationDatabaseIsSafe({
      NODE_ENV: 'development',
    })).toThrow('Simulation database access blocked');
  });
});
