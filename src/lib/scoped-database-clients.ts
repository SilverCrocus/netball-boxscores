import 'server-only';
import { PrismaClient } from '@prisma/client';

type ScopedDatabaseGlobals = {
  analyticsDatabase?: PrismaClient;
  statsOperationsDatabase?: PrismaClient;
};

const scopedGlobals = globalThis as typeof globalThis & ScopedDatabaseGlobals;

type ScopedDatabaseUrlName = 'ANALYTICS_DATABASE_URL' | 'STATS_OPERATIONS_DATABASE_URL';

const CONNECTION_LIMITS: Record<ScopedDatabaseUrlName, number> = {
  ANALYTICS_DATABASE_URL: 5,
  STATS_OPERATIONS_DATABASE_URL: 2,
};

/**
 * Runtime credentials use Supavisor transaction mode. Prisma must disable
 * prepared statements for that mode, and each role gets a deliberately small
 * process-local pool. DIRECT_URL remains exclusively for migrations and role
 * administration.
 */
function requiredDatabaseUrl(name: ScopedDatabaseUrlName): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when its feature is enabled`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection URL`);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`${name} must be a PostgreSQL connection URL`);
  }
  url.searchParams.set('pgbouncer', 'true');
  url.searchParams.set('connection_limit', String(CONNECTION_LIMITS[name]));
  url.searchParams.set('pool_timeout', '5');
  return url.toString();
}

function createScopedClient(name: ScopedDatabaseUrlName): PrismaClient {
  return new PrismaClient({ datasourceUrl: requiredDatabaseUrl(name) });
}

/** Lazily creates the SELECT-only analytics connection pool. */
export function getAnalyticsDatabase(): PrismaClient {
  scopedGlobals.analyticsDatabase ??= createScopedClient('ANALYTICS_DATABASE_URL');
  return scopedGlobals.analyticsDatabase;
}

/** Lazily creates the EXECUTE-only operations connection pool. */
export function getStatsOperationsDatabase(): PrismaClient {
  scopedGlobals.statsOperationsDatabase ??= createScopedClient('STATS_OPERATIONS_DATABASE_URL');
  return scopedGlobals.statsOperationsDatabase;
}

export function scopedDatabaseConfiguration(): {
  analyticsDatabaseUrlConfigured: boolean;
  analyticsDatabaseUrlValid: boolean;
  statsOperationsDatabaseUrlConfigured: boolean;
  statsOperationsDatabaseUrlValid: boolean;
} {
  const analyticsDatabaseUrlConfigured = Boolean(process.env.ANALYTICS_DATABASE_URL?.trim());
  const statsOperationsDatabaseUrlConfigured = Boolean(process.env.STATS_OPERATIONS_DATABASE_URL?.trim());
  const valid = (name: ScopedDatabaseUrlName, configured: boolean): boolean => {
    if (!configured) return false;
    try {
      requiredDatabaseUrl(name);
      return true;
    } catch {
      return false;
    }
  };
  return {
    analyticsDatabaseUrlConfigured,
    analyticsDatabaseUrlValid: valid('ANALYTICS_DATABASE_URL', analyticsDatabaseUrlConfigured),
    statsOperationsDatabaseUrlConfigured,
    statsOperationsDatabaseUrlValid: valid(
      'STATS_OPERATIONS_DATABASE_URL',
      statsOperationsDatabaseUrlConfigured,
    ),
  };
}
