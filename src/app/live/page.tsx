import { redirect } from 'next/navigation';
import { getLiveState } from '@/lib/live-state';

export const dynamic = 'force-dynamic';

export default async function LivePage() {
  const state = await getLiveState();

  if (state.liveMatchIds.length > 0) {
    redirect(`/match/${state.liveMatchIds[0]}/live`);
  }

  // No live match — redirect to home
  redirect('/');
}
