import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getWorkerHealth } from '@/lib/worker-health';
import { getWorkerStartupDecision } from '@/lib/worker-startup';

export const dynamic = 'force-dynamic';

const DATABASE_TIMEOUT_MS = 3_000;

async function probeDatabase() {
  const startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      prisma.$queryRaw(Prisma.sql`SELECT 1 AS ready`),
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
  const [database, workerHealth] = await Promise.all([
    probeDatabase(),
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
  const ready = database.ok && workerSatisfiesReadiness;

  return NextResponse.json({
    status: ready ? 'ready' : 'degraded',
    type: 'readiness',
    timestamp: new Date().toISOString(),
    checks: {
      database,
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
