'use client';

import { useEffect, useState } from 'react';
import { MatchPlayByPlay } from '@/components/match/MatchPlayByPlay';
import type { TeamInfoWithId } from '@/types/team';
import {
  MATCH_TIMELINE_EVENT_TYPES,
  type MatchTimelineEntry,
  type MatchTimelineEventType,
  type MatchTimelineResponse,
} from '@/types/match-timeline';

interface MatchTimelineProps {
  awayTeam: TeamInfoWithId;
  competitionId?: string | null;
  homeTeam: TeamInfoWithId;
  matchId: string;
}

export function MatchTimeline({ awayTeam, competitionId, homeTeam, matchId }: MatchTimelineProps) {
  const [entries, setEntries] = useState<MatchTimelineEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [eventType, setEventType] = useState<'' | MatchTimelineEventType>('');
  const [quarter, setQuarter] = useState('');
  const [teamId, setTeamId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function loadInitialPage() {
      setLoading(true);
      setError('');
      setAnnouncement('');
      setEntries([]);
      setNextCursor(null);

      try {
        const params = new URLSearchParams({ limit: '75' });
        if (eventType) params.set('type', eventType);
        if (quarter) params.set('quarter', quarter);
        if (teamId) params.set('team', teamId);
        const response = await fetch(`/api/matches/${matchId}/events?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = await response.json() as MatchTimelineResponse & {
          error?: { message?: string };
        };
        if (!response.ok || !payload.entries) {
          throw new Error(payload.error?.message || 'Could not load play by play.');
        }
        setEntries(payload.entries);
        setNextCursor(payload.nextCursor);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : 'Could not load play by play.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadInitialPage();
    return () => controller.abort();
  }, [eventType, matchId, quarter, teamId]);

  async function loadOlderEvents() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({ limit: '75', cursor: nextCursor });
      if (eventType) params.set('type', eventType);
      if (quarter) params.set('quarter', quarter);
      if (teamId) params.set('team', teamId);
      const response = await fetch(`/api/matches/${matchId}/events?${params.toString()}`);
      const payload = await response.json() as MatchTimelineResponse & {
        error?: { message?: string };
      };
      if (!response.ok || !payload.entries) {
        throw new Error(payload.error?.message || 'Could not load older events.');
      }
      setEntries((current) => {
        const knownIds = new Set(current.map((entry) => entry.id));
        return [...current, ...payload.entries.filter((entry) => !knownIds.has(entry.id))];
      });
      setNextCursor(payload.nextCursor);
      setAnnouncement(`${payload.entries.length} older ${payload.entries.length === 1 ? 'event' : 'events'} added.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load older events.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl bg-surface-container-low p-4 sm:grid-cols-3">
        <label className="grid gap-1 font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant">
          Quarter
          <select
            value={quarter}
            onChange={(event) => setQuarter(event.target.value)}
            className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-sm text-on-surface"
          >
            <option value="">All quarters</option>
            {[1, 2, 3, 4].map((value) => <option key={value} value={value}>Quarter {value}</option>)}
          </select>
        </label>
        <label className="grid gap-1 font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant">
          Event
          <select
            value={eventType}
            onChange={(event) => setEventType(event.target.value as '' | MatchTimelineEventType)}
            className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-sm text-on-surface"
          >
            <option value="">All events</option>
            {MATCH_TIMELINE_EVENT_TYPES.map((value) => (
              <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant">
          Team
          <select
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
            className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-sm text-on-surface"
          >
            <option value="">Both teams</option>
            <option value={homeTeam.id}>{homeTeam.name}</option>
            <option value={awayTeam.id}>{awayTeam.name}</option>
          </select>
        </label>
      </div>

      <div aria-live="polite" className="sr-only">{announcement}</div>
      {loading && entries.length === 0 && (
        <div role="status" className="rounded-xl bg-surface-container-low px-6 py-12 text-center text-on-surface-variant">
          Loading play by play…
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-xl border border-error/30 bg-error/5 px-5 py-4 text-sm text-error">
          {error}
        </div>
      )}
      {!loading && !error && entries.length === 0 && (
        <p className="rounded-xl bg-surface-container-low px-6 py-12 text-center text-on-surface-variant">
          No events match these filters.
        </p>
      )}
      {entries.length > 0 && (
        <MatchPlayByPlay
          entries={[...entries].reverse()}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          competitionId={competitionId}
        />
      )}
      {nextCursor && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={loadOlderEvents}
            disabled={loading}
            className="min-h-11 rounded-xl border border-primary-container px-5 font-headline text-sm font-bold uppercase tracking-wider text-primary-container disabled:opacity-60"
          >
            {loading ? 'Loading older events…' : 'Load older events'}
          </button>
        </div>
      )}
    </div>
  );
}
