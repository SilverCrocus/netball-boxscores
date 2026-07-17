import { prisma, excludeSimData } from '@/lib/db';
import { NextResponse } from 'next/server';
import { getSydneyDayBounds } from '@/lib/time-zone';
import {
  canExposePublicMatchScore,
  resolvePublicMatchAccess,
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
  });

  const publicMatches = (await Promise.all(matches.map(async (match) => ({
    match,
    access: await resolvePublicMatchAccess(match.id).catch(() => null),
  })))).flatMap(({ match, access }) => {
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
