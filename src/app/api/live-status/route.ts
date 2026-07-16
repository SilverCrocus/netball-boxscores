import { NextResponse } from 'next/server';
import { getLiveState } from '@/lib/live-state';
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

  const state = await getLiveState();

  return NextResponse.json(
    {
      hasLive: state.liveMatchIds.length > 0,
      nextMatchAt: state.nextMatchAt,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    },
  );
}
