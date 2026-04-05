import { prisma, excludeSimData } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);
  const fiveMinsFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  const [liveCount, nearLiveCount, nextMatch] = await Promise.all([
    prisma.match.count({
      where: { ...excludeSimData, status: 'LIVE' },
    }),
    // Matches that should be live — SCHEDULED but within the start window.
    // The worker may not have polled Champion Data yet.
    prisma.match.count({
      where: {
        ...excludeSimData,
        status: 'SCHEDULED',
        scheduledAt: { gte: fifteenMinsAgo, lte: fiveMinsFromNow },
      },
    }),
    prisma.match.findFirst({
      where: {
        ...excludeSimData,
        status: 'SCHEDULED',
        scheduledAt: { gte: now, lte: oneHourFromNow },
      },
      orderBy: { scheduledAt: 'asc' },
      select: { scheduledAt: true },
    }),
  ]);

  return NextResponse.json(
    {
      hasLive: liveCount > 0,
      nearLive: nearLiveCount > 0,
      nextMatchAt: nextMatch?.scheduledAt ?? null,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    },
  );
}
