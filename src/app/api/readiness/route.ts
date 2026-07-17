import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  getAnalyticsDatabase,
  getStatsOperationsDatabase,
  scopedDatabaseConfiguration,
} from '@/lib/scoped-database-clients';
import { resolveRuntimeFeatureState } from '@/lib/server-feature-flags';
import { statsRateLimitSecretConfigured } from '@/lib/stat-query/operations';
import { getWorkerHealth } from '@/lib/worker-health';
import { getWorkerStartupDecision } from '@/lib/worker-startup';

export const dynamic = 'force-dynamic';

const DATABASE_TIMEOUT_MS = 3_000;

async function probeDatabase(client: { $queryRaw: typeof prisma.$queryRaw }) {
  const startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      client.$queryRaw(Prisma.sql`SELECT 1 AS ready`),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Database readiness probe timed out')),
          DATABASE_TIMEOUT_MS,
        );
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch {
    return { ok: false, latencyMs: Date.now() - startedAt };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function GET(): Promise<NextResponse> {
  const features = resolveRuntimeFeatureState();
  const scopedConfiguration = scopedDatabaseConfiguration();
  const analyticsConfigured = !features.analyticsEnabled || (
    scopedConfiguration.analyticsDatabaseUrlConfigured
    && scopedConfiguration.analyticsDatabaseUrlValid
  );
  const operationsConfigured = !features.askCentrePassEnabled || (
    scopedConfiguration.statsOperationsDatabaseUrlConfigured
    && scopedConfiguration.statsOperationsDatabaseUrlValid
  );
  const rateLimitSecretConfigured = !features.askCentrePassEnabled || statsRateLimitSecretConfigured();

  const [database, analyticsProbe, operationsProbe, workerHealth] = await Promise.all([
    probeDatabase(prisma),
    features.analyticsEnabled && analyticsConfigured
      ? probeDatabase(getAnalyticsDatabase())
      : Promise.resolve(null),
    features.askCentrePassEnabled && operationsConfigured
      ? probeDatabase(getStatsOperationsDatabase())
      : Promise.resolve(null),
    Promise.resolve(getWorkerHealth()),
  ]);
  const workerStartup = getWorkerStartupDecision();
  const workerIsHealthy = workerStartup.state === 'enabled' && workerHealth.isHealthy;
  const workerSatisfiesReadiness = workerStartup.state === 'enabled'
    ? workerIsHealthy
    : workerStartup.state === 'disabled' && !workerStartup.required;
  const workerState = workerStartup.state === 'enabled'
    ? workerIsHealthy ? 'healthy' : 'unhealthy'
    : workerStartup.state;
  const configurationOk = features.configurationErrors.length === 0;
  const analyticsSatisfiesReadiness = !features.analyticsEnabled
    || (analyticsConfigured && analyticsProbe?.ok === true);
  const operationsSatisfiesReadiness = !features.askCentrePassEnabled
    || (operationsConfigured && operationsProbe?.ok === true);
  const ready = database.ok
    && workerSatisfiesReadiness
    && configurationOk
    && analyticsSatisfiesReadiness
    && operationsSatisfiesReadiness
    && rateLimitSecretConfigured;

  return NextResponse.json({
    status: ready ? 'ready' : 'degraded',
    type: 'readiness',
    timestamp: new Date().toISOString(),
    checks: {
      database,
      configuration: {
        ok: configurationOk,
        errors: features.configurationErrors,
      },
      analytics: {
        ok: features.analyticsEnabled ? analyticsProbe?.ok === true : false,
        satisfiesReadiness: analyticsSatisfiesReadiness,
        state: features.analyticsEnabled
          ? analyticsProbe?.ok ? 'healthy' : analyticsConfigured ? 'unhealthy' : 'misconfigured'
          : 'disabled',
        enabled: features.analyticsEnabled,
        configured: scopedConfiguration.analyticsDatabaseUrlConfigured,
        connectionUrlValid: scopedConfiguration.analyticsDatabaseUrlValid,
        latencyMs: analyticsProbe?.latencyMs ?? null,
      },
      statsOperations: {
        ok: features.askCentrePassEnabled ? operationsProbe?.ok === true : false,
        satisfiesReadiness: operationsSatisfiesReadiness && rateLimitSecretConfigured,
        state: features.askCentrePassEnabled
          ? operationsProbe?.ok && rateLimitSecretConfigured
            ? 'healthy'
            : operationsConfigured && rateLimitSecretConfigured ? 'unhealthy' : 'misconfigured'
          : 'disabled',
        enabled: features.askCentrePassEnabled,
        configured: scopedConfiguration.statsOperationsDatabaseUrlConfigured,
        connectionUrlValid: scopedConfiguration.statsOperationsDatabaseUrlValid,
        rateLimitSecretConfigured: statsRateLimitSecretConfigured(),
        latencyMs: operationsProbe?.latencyMs ?? null,
      },
      worker: {
        ok: workerIsHealthy,
        satisfiesReadiness: workerSatisfiesReadiness,
        state: workerState,
        enabled: workerStartup.shouldStart,
        required: workerStartup.required,
        reason: workerStartup.reason,
        isHealthy: workerIsHealthy,
        lastPollAt: workerHealth.lastPollAt,
        lastPollStatus: workerHealth.lastPollStatus,
        currentIntervalMs: workerHealth.currentIntervalMs,
      },
    },
  }, {
    status: ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
