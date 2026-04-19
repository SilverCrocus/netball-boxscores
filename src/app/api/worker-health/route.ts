import { NextResponse } from 'next/server';
import { getWorkerHealth } from '@/lib/worker-health';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getWorkerHealth(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
