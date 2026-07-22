import { NextResponse } from 'next/server';
import { getLiveStatus } from '@/lib/live-state';
import { isUpstreamPreviewMode, loadUpstreamLiveStatus } from '@/lib/upstream-preview';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (isUpstreamPreviewMode()) {
    const previewStatus = await loadUpstreamLiveStatus();
    if (previewStatus) {
      return NextResponse.json(previewStatus, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      });
    }
  }

  const status = await getLiveStatus();

  return NextResponse.json(
    {
      hasLive: status.hasLive,
      nextMatchAt: status.nextMatchAt,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    },
  );
}
