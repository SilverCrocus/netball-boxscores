import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function LivePage() {
  const liveMatch = await prisma.match.findFirst({
    where: { status: 'LIVE' },
    orderBy: { scheduledAt: 'asc' },
  });

  if (liveMatch) {
    redirect(`/match/${liveMatch.id}/live`);
  }

  // No live matches — redirect to home
  redirect('/');
}
