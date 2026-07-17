import { prisma, excludeSimData } from '@/lib/db';
import { NextResponse } from 'next/server';
import { getSydneyDayBounds } from '@/lib/time-zone';
import {
  canExposePublicMatchScore,
  resolvePublicMatchAccessBatch,
} from '@/lib/public-match';

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
    take: 64,
  });

  const accessById = await resolvePublicMatchAccessBatch(matches.map((match) => match.id))
    .catch(() => new Map());
  const publicMatches = matches.flatMap((match) => {
    const access = accessById.get(match.id);
    if (!access) return [];

    const scoreAvailable = canExposePublicMatchScore(access);
    const clockAvailable = scoreAvailable && access.status === 'LIVE';
    return [{
      ...match,
      status: access.status,
      homeScore: scoreAvailable ? match.homeScore : null,
      awayScore: scoreAvailable ? match.awayScore : null,
      currentQuarter: clockAvailable ? match.currentQuarter : null,
      currentTime: clockAvailable ? match.currentTime : null,
      scoreAvailable,
    }];
  });

  return NextResponse.json(publicMatches, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
