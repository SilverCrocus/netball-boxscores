'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { ScoreCard } from '@/components/ui/ScoreCard';
import { TeamBadge } from '@/components/ui/TeamBadge';
import type { MyTeamHubItem } from '@/types/personalization';

export function MyTeams() {
  const { status } = useSession();
  const [items, setItems] = useState<MyTeamHubItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (status !== 'authenticated') return;
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError('');
      try {
        const response = await fetch('/api/user/home', { signal: controller.signal });
        const payload = await response.json() as MyTeamHubItem[] & { error?: { message?: string } };
        if (!response.ok || !Array.isArray(payload)) {
          throw new Error(payload.error?.message || 'Your teams are temporarily unavailable.');
        }
        setItems(payload);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : 'Your teams are temporarily unavailable.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [status]);

  if (status !== 'authenticated') return null;

  if (loading && items.length === 0) {
    return (
      <section aria-labelledby="my-teams-heading" className="mb-16">
        <h2 id="my-teams-heading" className="mb-6 font-headline text-xl font-bold text-primary">MY TEAMS</h2>
        <div role="status" className="h-32 animate-pulse rounded-xl bg-surface-container-low">
          <span className="sr-only">Loading your teams</span>
        </div>
      </section>
    );
  }

  if (error) {
    return <p role="alert" className="mb-12 rounded-xl bg-error/5 px-5 py-4 text-sm text-error">{error}</p>;
  }

  if (items.length === 0) {
    return (
      <section aria-labelledby="my-teams-heading" className="mb-16 rounded-xl bg-surface-container-lowest p-6 shadow-sm">
        <h2 id="my-teams-heading" className="font-headline text-xl font-bold text-primary">MY TEAMS</h2>
        <p className="mt-2 text-sm text-on-surface-variant">Follow a team to put its next fixture and latest result here.</p>
        <Link href="/settings" className="mt-4 inline-flex min-h-11 items-center font-headline text-sm font-bold text-secondary">Choose teams</Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="my-teams-heading" className="mb-16">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 id="my-teams-heading" className="font-headline text-xl font-bold text-primary">MY TEAMS</h2>
        <Link href="/settings" className="font-label text-xs font-bold uppercase tracking-wider text-secondary">Manage</Link>
      </div>
      <div className="space-y-8">
        {items.map((item) => (
          <article key={item.team.id} className="rounded-2xl border border-outline-variant/15 bg-surface-container-low p-4 sm:p-6">
            <div className="mb-4 flex items-center gap-3">
              <TeamBadge team={item.team} size={40} />
              <h3 className="font-headline text-lg font-black text-primary">{item.team.name}</h3>
            </div>
            {item.nextMatch || item.latestResult ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {item.nextMatch && <ScoreCard match={item.nextMatch} />}
                {item.latestResult && <ScoreCard match={item.latestResult} />}
              </div>
            ) : (
              <p className="text-sm text-on-surface-variant">No current-season fixtures or results are available.</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
