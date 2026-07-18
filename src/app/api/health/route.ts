import { NextResponse } from 'next/server';
import packageMetadata from '../../../../package.json';

const startedAt = Date.now();

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: 'ok',
    type: 'liveness',
    timestamp: new Date().toISOString(),
    uptimeMs: Date.now() - startedAt,
    version: packageMetadata.version,
    release: {
      commit: process.env.RENDER_GIT_COMMIT || null,
      branch: process.env.RENDER_GIT_BRANCH || null,
      node: process.version,
    },
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
