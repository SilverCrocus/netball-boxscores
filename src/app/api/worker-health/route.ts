import { NextResponse } from 'next/server';
import { getWorkerHealth } from '@/lib/worker-health';
import { getWorkerStartupDecision } from '@/lib/worker-startup';

export const dynamic = 'force-dynamic';

export async function GET() {
  const health = getWorkerHealth();
  const startup = getWorkerStartupDecision();

  return NextResponse.json({
    ...health,
    isHealthy: startup.shouldStart && health.isHealthy,
    enabled: startup.shouldStart,
    required: startup.required,
    startupState: startup.state,
    startupReason: startup.reason,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
