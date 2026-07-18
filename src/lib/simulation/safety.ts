const SAFE_SIMULATION_DATABASE_ENVIRONMENTS = new Set([
  'local',
  'development',
  'test',
]);

export interface SimulationSafetyEnvironment {
  NODE_ENV?: string;
  DATABASE_ENVIRONMENT?: string;
  ALLOW_SHARED_PRODUCTION_DB_WRITES?: string;
}

export interface SimulationDatabaseSafetyDecision {
  allowed: boolean;
  databaseEnvironment: string | 'unspecified';
  reason: string;
}

/**
 * Simulation is deliberately narrower than ordinary worker execution because
 * it creates and deletes temporary rows. Shared staging and production
 * databases are never valid simulation targets.
 */
export function getSimulationDatabaseSafetyDecision(
  env: SimulationSafetyEnvironment = process.env,
): SimulationDatabaseSafetyDecision {
  const databaseEnvironment = env.DATABASE_ENVIRONMENT?.trim().toLowerCase()
    || 'unspecified';

  if (env.NODE_ENV === 'production') {
    return {
      allowed: false,
      databaseEnvironment,
      reason: 'Simulation cannot run in a production process',
    };
  }

  if (!SAFE_SIMULATION_DATABASE_ENVIRONMENTS.has(databaseEnvironment)) {
    return {
      allowed: false,
      databaseEnvironment,
      reason: 'Simulation requires DATABASE_ENVIRONMENT=local, development, or test',
    };
  }

  return {
    allowed: true,
    databaseEnvironment,
    reason: 'Simulation database is disposable',
  };
}

export function assertSimulationDatabaseIsSafe(
  env: SimulationSafetyEnvironment = process.env,
): void {
  const decision = getSimulationDatabaseSafetyDecision(env);
  if (!decision.allowed) {
    throw new Error(`Simulation database access blocked: ${decision.reason}`);
  }
}
