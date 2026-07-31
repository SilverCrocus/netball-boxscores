'use client';

import { useState } from 'react';
import { HomeResultRow } from '@/components/home/landing/HomeResultRow';
import type { HomeResultGroup } from '@/lib/home-feed';

interface HomeResultsProps {
  initialGroups: HomeResultGroup[];
  initialNextCursor: string | null;
  season: number;
  editionId: string;
  timezone?: string;
}

function mergeGroups(current: HomeResultGroup[], incoming: HomeResultGroup[]): HomeResultGroup[] {
  const merged = current.map((group) => ({ ...group, matches: [...group.matches] }));

  for (const incomingGroup of incoming) {
    const existing = merged.find((group) => group.label === incomingGroup.label);
    if (existing) {
      const knownIds = new Set(existing.matches.map((match) => match.id));
      existing.matches.push(...incomingGroup.matches.filter((match) => !knownIds.has(match.id)));
      existing.matches.sort(
        (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
      );
    } else {
      merged.push(incomingGroup);
    }
  }

  return merged;
}

export function HomeResults({
  initialGroups,
  initialNextCursor,
  season,
  editionId,
  timezone,
}: HomeResultsProps) {
  const [groups, setGroups] = useState(initialGroups);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');

  async function loadEarlierResults() {
    if (!nextCursor || loading) return;

    setLoading(true);
    setError('');
    setAnnouncement('');

    try {
      const params = new URLSearchParams({
        edition: editionId,
        season: String(season),
        cursor: nextCursor,
      });
      const response = await fetch(`/api/matches?${params.toString()}`);
      const payload = await response.json() as {
        groups?: HomeResultGroup[];
        nextCursor?: string | null;
        error?: { message?: string };
      };

      if (!response.ok || !payload.groups) {
        throw new Error(payload.error?.message || 'Could not load earlier results.');
      }

      const addedCount = payload.groups.reduce((sum, group) => sum + group.matches.length, 0);
      setGroups((current) => mergeGroups(current, payload.groups ?? []));
      setNextCursor(payload.nextCursor ?? null);
      setAnnouncement(`${addedCount} earlier ${addedCount === 1 ? 'result' : 'results'} added.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load earlier results.');
    } finally {
      setLoading(false);
    }
  }

  // A bounded server scan can legitimately find no public rows yet still
  // return a cursor to older candidates. Keep that continuation reachable.
  if (groups.length === 0 && !nextCursor) return null;

  return (
    <section aria-labelledby="results-heading">
      <div className="mb-3 flex min-h-11 items-center justify-between gap-4">
        <h2
          id="results-heading"
          className="font-headline text-lg font-extrabold uppercase tracking-[-0.02em] text-primary sm:text-xl"
        >
          RESULTS
        </h2>
        <span className="font-label text-[0.65rem] font-bold uppercase tracking-[0.05em] text-secondary">
          Matchday archive
        </span>
      </div>

      <div className="space-y-8">
        {groups.map((group) => (
          <div
            key={group.label}
            className="[content-visibility:auto] [contain-intrinsic-size:0_240px]"
          >
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-outline-variant/70">
              <h3 className="font-headline text-sm font-extrabold uppercase tracking-[-0.01em] text-primary">
                {group.label}
              </h3>
              <span className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.05em] text-on-surface-variant">
                {group.matches.length} {group.matches.length === 1 ? 'match' : 'matches'}
              </span>
            </div>
            <ul
              aria-label={`${group.label} results`}
              className="divide-y divide-outline-variant/60 border-b border-outline-variant/60"
            >
              {group.matches.map((match) => (
                <li key={match.id}>
                  <HomeResultRow match={match} timezone={timezone} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div aria-live="polite" className="sr-only">{announcement}</div>
      {error && (
        <p role="alert" className="mt-6 text-center font-label text-sm text-error">
          {error}
        </p>
      )}
      {nextCursor && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={loadEarlierResults}
            disabled={loading}
            className="group inline-flex min-h-11 items-center gap-2 rounded-md border border-primary-container px-5 py-2.5 font-headline text-xs font-bold uppercase tracking-[0.06em] text-primary-container transition-colors hover:bg-primary-container hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? 'Loading earlier results…' : error ? 'Try earlier results again' : 'View previous rounds'}
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-base transition-transform group-hover:translate-y-0.5"
            >
              expand_more
            </span>
          </button>
        </div>
      )}
    </section>
  );
}
