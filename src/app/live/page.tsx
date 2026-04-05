import { redirect } from 'next/navigation';
import { prisma, excludeSimData } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function LivePage() {
  const liveMatch = await prisma.match.findFirst({
    where: { ...excludeSimData, status: 'LIVE' },
    orderBy: { scheduledAt: 'asc' },
  });

  if (liveMatch) {
    redirect(`/match/${liveMatch.id}/live`);
  }

  // Check for matches that should be live — the worker may not have polled
  // Champion Data yet, so the DB still says SCHEDULED even though the match
  // has started. Look for SCHEDULED matches within [-15min, +5min] of now.
  const now = new Date();
  const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);
  const fiveMinsFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  const nearLiveMatch = await prisma.match.findFirst({
    where: {
      ...excludeSimData,
      status: 'SCHEDULED',
      scheduledAt: { gte: fifteenMinsAgo, lte: fiveMinsFromNow },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  if (nearLiveMatch) {
    redirect(`/match/${nearLiveMatch.id}/live`);
  }

  // No live or near-live matches — redirect to home
  redirect('/');
}
