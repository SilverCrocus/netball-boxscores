import { NextResponse } from 'next/server';

const startedAt = Date.now();

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: 'ok',
    type: 'liveness',
    timestamp: new Date().toISOString(),
    uptimeMs: Date.now() - startedAt,
    version: process.env.npm_package_version || '1.0.0',
    release: {
      commit: process.env.RENDER_GIT_COMMIT || null,
      branch: process.env.RENDER_GIT_BRANCH || null,
    },
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
