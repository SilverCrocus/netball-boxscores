import { NextResponse } from 'next/server';
import { getLiveState } from '@/lib/live-state';

export const dynamic = 'force-dynamic';

export async function GET() {
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
