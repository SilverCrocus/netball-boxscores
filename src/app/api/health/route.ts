import { NextResponse } from 'next/server';

const startedAt = Date.now();

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: 'ok',
    type: 'liveness',
    timestamp: new Date().toISOString(),
    uptimeMs: Date.now() - startedAt,
    version: process.env.npm_package_version || '1.0.0',
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
