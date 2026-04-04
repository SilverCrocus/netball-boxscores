import { prisma, excludeSimData } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  const [liveCount, nextMatch] = await Promise.all([
    prisma.match.count({
      where: { ...excludeSimData, status: 'LIVE' },
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
    { hasLive: liveCount > 0, nextMatchAt: nextMatch?.scheduledAt ?? null },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    },
  );
}
