import { prisma, excludeSimData } from '@/lib/db';
import { NextResponse } from 'next/server';
import { getSydneyDayBounds } from '@/lib/time-zone';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { start, end } = getSydneyDayBounds();

  const matches = await prisma.match.findMany({
    where: {
      ...excludeSimData,
      scheduledAt: { gte: start, lt: end },
    },
    select: {
      id: true,
      status: true,
      homeScore: true,
      awayScore: true,
      currentQuarter: true,
      currentTime: true,
      scheduledAt: true,
    },
    orderBy: { scheduledAt: 'asc' },
  });

  return NextResponse.json(matches, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
