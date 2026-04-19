import { prisma, excludeSimData } from '@/lib/db';

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

  // Pin to AEST for match-day check
  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value) - 1;
  const day = Number(parts.find((p) => p.type === 'day')!.value);
  const aestStartOfDay = new Date(Date.UTC(year, month, day) - 11 * 60 * 60 * 1000);
  const aestEndOfDay = new Date(Date.UTC(year, month, day + 1) - 10 * 60 * 60 * 1000);

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
          scheduledAt: { gte: aestStartOfDay, lt: aestEndOfDay },
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
