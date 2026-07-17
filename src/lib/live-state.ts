import { prisma, excludeSimData } from '@/lib/db';
import { getSydneyDayBounds } from '@/lib/time-zone';
import { resolvePublicMatchAccess } from '@/lib/public-match';

export interface LiveState {
  liveMatches: Array<{ id: string; competitionId: string }>;
  liveMatchIds: string[];
  imminentMatchIds: string[];
  nextMatchAt: Date | null;
  isMatchDay: boolean;
}

export async function getLiveState(): Promise<LiveState> {
  const now = new Date();
  const sixtyMinsAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const sixtyMinsFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  const { start: startOfSydneyDay, end: endOfSydneyDay } = getSydneyDayBounds(now);
  const candidateWindowStart = new Date(Math.min(
    startOfSydneyDay.getTime(),
    sixtyMinsAgo.getTime(),
  ));
  const candidateWindowEnd = new Date(Math.max(
    endOfSydneyDay.getTime(),
    sixtyMinsFromNow.getTime(),
  ));

  const candidates = await prisma.match.findMany({
    where: {
      ...excludeSimData,
      OR: [
        { status: 'LIVE' },
        { scheduledAt: { gte: candidateWindowStart, lt: candidateWindowEnd } },
      ],
    },
    select: { id: true, competitionId: true, scheduledAt: true },
  });

  const publicCandidates = (await Promise.all(candidates.map(async (match) => ({
    match,
    access: await resolvePublicMatchAccess(match.id).catch(() => null),
  })))).flatMap(({ match, access }) => access ? [{ match, access }] : []);

  const liveMatches = publicCandidates
    .filter(({ access }) => access.status === 'LIVE')
    .map(({ match }) => ({ id: match.id, competitionId: match.competitionId }));
  const imminentMatches = publicCandidates.filter(({ match, access }) =>
    access.status === 'SCHEDULED'
      && match.scheduledAt >= sixtyMinsAgo
      && match.scheduledAt <= sixtyMinsFromNow
  );
  const nextMatch = publicCandidates
    .filter(({ match, access }) =>
      access.status === 'SCHEDULED'
        && match.scheduledAt >= now
        && match.scheduledAt <= sixtyMinsFromNow
    )
    .toSorted((left, right) => left.match.scheduledAt.getTime() - right.match.scheduledAt.getTime())[0];
  const isMatchDay = publicCandidates.some(({ match }) =>
    match.scheduledAt >= startOfSydneyDay && match.scheduledAt < endOfSydneyDay
  );

  return {
    liveMatches,
    liveMatchIds: liveMatches.map((m) => m.id),
    imminentMatchIds: imminentMatches.map(({ match }) => match.id),
    nextMatchAt: nextMatch?.match.scheduledAt ?? null,
    isMatchDay,
  };
}
