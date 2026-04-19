import { prisma, excludeSimData } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value) - 1;
  const day = Number(parts.find((p) => p.type === 'day')!.value);
  const aestStartOfDay = new Date(Date.UTC(year, month, day) - 11 * 60 * 60 * 1000);
  const aestEndOfDay = new Date(Date.UTC(year, month, day + 1) - 10 * 60 * 60 * 1000);

  const matches = await prisma.match.findMany({
    where: {
      ...excludeSimData,
      scheduledAt: { gte: aestStartOfDay, lt: aestEndOfDay },
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
