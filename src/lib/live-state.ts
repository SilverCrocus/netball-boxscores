import { prisma, excludeSimData } from '@/lib/db';
import { getSydneyDayBounds } from '@/lib/time-zone';

export interface LiveState {
  liveMatchIds: string[];
  imminentMatchIds: string[];
  nextMatchAt: Date | null;
  isMatchDay: boolean;
}

export async function getLiveState(): Promise<LiveState> {
  const now = new Date();
  const sixtyMinsAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const sixtyMinsFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  const { start: startOfSydneyDay, end: endOfSydneyDay } = getSydneyDayBounds(now);

  const [liveMatches, imminentMatches, nextMatch, matchDayCount] =
    await Promise.all([
      prisma.match.findMany({
        where: { ...excludeSimData, status: 'LIVE' },
        select: { id: true },
      }),
      prisma.match.findMany({
        where: {
          ...excludeSimData,
          status: 'SCHEDULED',
          scheduledAt: { gte: sixtyMinsAgo, lte: sixtyMinsFromNow },
        },
        select: { id: true },
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
      prisma.match.count({
        where: {
          ...excludeSimData,
          scheduledAt: { gte: startOfSydneyDay, lt: endOfSydneyDay },
        },
      }),
    ]);

  return {
    liveMatchIds: liveMatches.map((m) => m.id),
    imminentMatchIds: imminentMatches.map((m) => m.id),
    nextMatchAt: nextMatch?.scheduledAt ?? null,
    isMatchDay: matchDayCount > 0,
  };
}
