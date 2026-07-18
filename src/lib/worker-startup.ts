const TRUE_VALUE = 'true';

const DATABASE_ENVIRONMENTS = [
  'local',
  'development',
  'test',
  'staging',
  'production',
] as const;

type DatabaseEnvironment = (typeof DATABASE_ENVIRONMENTS)[number];

type WorkerStartupState = 'enabled' | 'disabled' | 'blocked';

export interface WorkerStartupDecision {
  state: WorkerStartupState;
  shouldStart: boolean;
  required: boolean;
  databaseEnvironment: DatabaseEnvironment | 'unspecified' | 'invalid';
  reason: string;
}

export interface WorkerStartupEnvironment {
  NODE_ENV?: string;
  WORKER_ENABLED?: string;
  DATABASE_ENVIRONMENT?: string;
  ALLOW_SHARED_PRODUCTION_DB_WRITES?: string;
}

function parseDatabaseEnvironment(
  value: string | undefined,
): DatabaseEnvironment | 'unspecified' | 'invalid' {
  if (!value?.trim()) return 'unspecified';

  const normalized = value.trim().toLowerCase();
  return DATABASE_ENVIRONMENTS.includes(normalized as DatabaseEnvironment)
    ? normalized as DatabaseEnvironment
    : 'invalid';
}

/**
 * Decide whether the in-process polling worker may start.
 *
 * Enabling the worker is always explicit. A database marker is also required
 * whenever polling is enabled so a copied production URL cannot silently be
 * treated as a disposable development database.
 */
export function getWorkerStartupDecision(
  env: WorkerStartupEnvironment = process.env,
): WorkerStartupDecision {
  const isProductionProcess = env.NODE_ENV === 'production';
  const workerRequested = env.WORKER_ENABLED === TRUE_VALUE;
  const databaseEnvironment = parseDatabaseEnvironment(env.DATABASE_ENVIRONMENT);

  if (!workerRequested) {
    return {
      state: 'disabled',
      shouldStart: false,
      required: isProductionProcess,
      databaseEnvironment,
      reason: 'WORKER_ENABLED is not set to true',
    };
  }

  if (databaseEnvironment === 'unspecified' || databaseEnvironment === 'invalid') {
    return {
      state: 'blocked',
      shouldStart: false,
      required: true,
      databaseEnvironment,
      reason: databaseEnvironment === 'unspecified'
        ? 'DATABASE_ENVIRONMENT must be set before enabling the worker'
        : `DATABASE_ENVIRONMENT must be one of: ${DATABASE_ENVIRONMENTS.join(', ')}`,
    };
  }

  const sharedProductionWriteAcknowledged =
    env.ALLOW_SHARED_PRODUCTION_DB_WRITES === TRUE_VALUE;

  if (
    !isProductionProcess &&
    databaseEnvironment === 'production' &&
    !sharedProductionWriteAcknowledged
  ) {
    return {
      state: 'blocked',
      shouldStart: false,
      required: true,
      databaseEnvironment,
      reason: 'A non-production worker cannot write to a production database unless ALLOW_SHARED_PRODUCTION_DB_WRITES=true',
    };
  }

  return {
    state: 'enabled',
    shouldStart: true,
    required: true,
    databaseEnvironment,
    reason: 'Worker explicitly enabled',
  };
}
