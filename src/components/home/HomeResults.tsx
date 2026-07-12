'use client';

import { useState } from 'react';
import { ScoreCard } from '@/components/ui/ScoreCard';
import type { HomeResultGroup } from '@/lib/home-feed';

interface HomeResultsProps {
  initialGroups: HomeResultGroup[];
  initialNextCursor: string | null;
  season: number;
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

export function HomeResults({ initialGroups, initialNextCursor, season }: HomeResultsProps) {
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
      const params = new URLSearchParams({ season: String(season), cursor: nextCursor });
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

  if (groups.length === 0) return null;

  return (
    <section className="mb-16" aria-labelledby="results-heading">
      <h2 id="results-heading" className="text-xl font-bold font-headline text-primary mb-6">
        RESULTS
      </h2>
      {groups.map((group) => (
        <div key={group.label} className="mb-8 [content-visibility:auto] [contain-intrinsic-size:0_320px]">
          <h3 className="text-sm font-semibold text-on-surface-variant mb-3 pb-2 border-b border-outline-variant">
            {group.label}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {group.matches.map((match) => (
              <ScoreCard
                key={match.id}
                match={{ ...match, round: undefined }}
                showFinalBadge={false}
              />
            ))}
          </div>
        </div>
      ))}

      <div aria-live="polite" className="sr-only">{announcement}</div>
      {error && (
        <p role="alert" className="mb-3 text-center font-label text-sm text-error">
          {error}
        </p>
      )}
      {nextCursor && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={loadEarlierResults}
            disabled={loading}
            className="rounded-xl border border-primary-container px-5 py-3 font-headline text-sm font-bold uppercase tracking-wider text-primary-container transition-colors hover:bg-primary-container hover:text-white disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? 'Loading earlier results…' : error ? 'Try earlier results again' : 'View previous rounds'}
          </button>
        </div>
      )}
    </section>
  );
}
