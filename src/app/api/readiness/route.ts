import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  probeAnalyticsDatabaseBoundary,
  probeStatsOperationsDatabaseBoundary,
} from '@/lib/scoped-database-boundary';
import { scopedDatabaseConfiguration } from '@/lib/scoped-database-clients';
import { resolveRuntimeFeatureState } from '@/lib/server-feature-flags';
import { statsRateLimitSecretConfigured } from '@/lib/stat-query/operations';
import { getWorkerHealth } from '@/lib/worker-health';
import { getWorkerStartupDecision } from '@/lib/worker-startup';

export const dynamic = 'force-dynamic';

const DATABASE_TIMEOUT_MS = 3_000;

type ProbeClient = { $queryRaw: typeof prisma.$queryRaw };

async function probeDatabase(client: ProbeClient) {
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
  const rateLimitSecretConfigured = !features.askCentrePassEnabled
    || statsRateLimitSecretConfigured();

  const [database, analyticsProbe, operationsProbe] = await Promise.all([
    probeDatabase(prisma),
    features.analyticsEnabled && analyticsConfigured
      ? probeAnalyticsDatabaseBoundary()
      : Promise.resolve(null),
    features.askCentrePassEnabled && operationsConfigured
      ? probeStatsOperationsDatabaseBoundary()
      : Promise.resolve(null),
  ]);
  const workerHealth = getWorkerHealth();
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
        connectionParametersOk: analyticsProbe?.connectionParametersOk ?? false,
        targetOk: analyticsProbe?.targetOk ?? false,
        hostOk: analyticsProbe?.hostOk ?? false,
        projectRefOk: analyticsProbe?.projectRefOk ?? false,
        urlRoleOk: analyticsProbe?.urlRoleOk ?? false,
        latencyMs: analyticsProbe?.latencyMs ?? null,
        identityOk: analyticsProbe?.identityOk ?? false,
        roleAttributesOk: analyticsProbe?.roleAttributesOk ?? false,
        noRoleMemberships: analyticsProbe?.noRoleMemberships ?? false,
        schemaUsageOk: analyticsProbe?.schemaUsageOk ?? false,
        readOnly: analyticsProbe?.readOnly ?? false,
        exactSurface: analyticsProbe?.exactSurface ?? false,
        noWritePrivileges: analyticsProbe?.noWritePrivileges ?? false,
        noSequencePrivileges: analyticsProbe?.noSequencePrivileges ?? false,
        noFunctionPrivileges: analyticsProbe?.noFunctionPrivileges ?? false,
        noSchemaCreate: analyticsProbe?.noSchemaCreate ?? false,
        statementTimeoutOk: analyticsProbe?.statementTimeoutOk ?? false,
        statementTimeoutMs: analyticsProbe?.statementTimeoutMs ?? null,
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
        connectionParametersOk: operationsProbe?.connectionParametersOk ?? false,
        rateLimitSecretConfigured: statsRateLimitSecretConfigured(),
        targetOk: operationsProbe?.targetOk ?? false,
        hostOk: operationsProbe?.hostOk ?? false,
        projectRefOk: operationsProbe?.projectRefOk ?? false,
        urlRoleOk: operationsProbe?.urlRoleOk ?? false,
        latencyMs: operationsProbe?.latencyMs ?? null,
        identityOk: operationsProbe?.identityOk ?? false,
        roleAttributesOk: operationsProbe?.roleAttributesOk ?? false,
        noRoleMemberships: operationsProbe?.noRoleMemberships ?? false,
        schemaUsageOk: operationsProbe?.schemaUsageOk ?? false,
        exactFunctionSurface: operationsProbe?.exactFunctionSurface ?? false,
        noRelationPrivileges: operationsProbe?.noRelationPrivileges ?? false,
        noSequencePrivileges: operationsProbe?.noSequencePrivileges ?? false,
        noSchemaCreate: operationsProbe?.noSchemaCreate ?? false,
        statementTimeoutOk: operationsProbe?.statementTimeoutOk ?? false,
        statementTimeoutMs: operationsProbe?.statementTimeoutMs ?? null,
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
        pollInProgress: workerHealth.pollInProgress,
        pollStartedAt: workerHealth.pollStartedAt,
        pollElapsedMs: workerHealth.pollElapsedMs,
        maxActivePollMs: workerHealth.maxActivePollMs,
      },
    },
  }, {
    status: ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
