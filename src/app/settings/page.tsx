'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { TeamBadge } from '@/components/ui/TeamBadge';
import type { TeamInfoWithId } from '@/types/team';
import Link from 'next/link';
import { formatMatchDateTime } from '@/lib/format';

interface TeamFollow {
  teamId: string;
  team: TeamInfoWithId;
}

interface MatchResource {
  matchId: string;
  match: {
    id: string;
    status: 'SCHEDULED' | 'LIVE' | 'COMPLETED';
    scheduledAt: string;
    homeScore: number;
    awayScore: number;
    homeTeam: { name: string };
    awayTeam: { name: string };
  };
}

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const [followedTeams, setFollowedTeams] = useState<TeamFollow[]>([]);
  const [allTeams, setAllTeams] = useState<TeamInfoWithId[]>([]);
  const [favorites, setFavorites] = useState<MatchResource[]>([]);
  const [reminders, setReminders] = useState<MatchResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (status !== 'authenticated') return;
    async function load() {
      try {
        const [teamsRes, followsRes, favoritesRes, remindersRes] = await Promise.all([
          fetch('/api/teams'),
          fetch('/api/user/teams'),
          fetch('/api/user/favorites'),
          fetch('/api/user/reminders'),
        ]);
        if (!teamsRes.ok || !followsRes.ok || !favoritesRes.ok || !remindersRes.ok) {
          throw new Error('Could not load settings');
        }
        const [teams, follows, favoriteMatches, reminderMatches] = await Promise.all([
          teamsRes.json(),
          followsRes.json(),
          favoritesRes.json(),
          remindersRes.json(),
        ]);
        setAllTeams(teams);
        setFollowedTeams(follows);
        setFavorites(favoriteMatches);
        setReminders(reminderMatches);
      } catch {
        setError('Settings are temporarily unavailable. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [status]);

  const followedIds = new Set(followedTeams.map((ft) => ft.teamId));

  const toggleTeam = async (teamId: string) => {
    const wasFollowed = followedIds.has(teamId);
    const team = allTeams.find((candidate) => candidate.id === teamId);
    if (!team) return;

    setPendingTeamId(teamId);
    setError('');
    setFollowedTeams((current) => wasFollowed
      ? current.filter((follow) => follow.teamId !== teamId)
      : [...current, { teamId, team }]);

    try {
      const response = await fetch('/api/user/teams', {
        method: wasFollowed ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      });
      if (!response.ok) throw new Error('Request failed');
    } catch {
      setFollowedTeams((current) => wasFollowed
        ? [...current, { teamId, team }]
        : current.filter((follow) => follow.teamId !== teamId));
      setError('Could not update that team. Your previous selection was restored.');
    } finally {
      setPendingTeamId(null);
    }
  };

  const removeMatchResource = async (
    kind: 'favorites' | 'reminders',
    resource: MatchResource,
  ) => {
    const current = kind === 'favorites' ? favorites : reminders;
    const update = kind === 'favorites' ? setFavorites : setReminders;
    update(current.filter((item) => item.matchId !== resource.matchId));
    setError('');

    try {
      const response = await fetch(`/api/user/${kind}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId: resource.matchId }),
      });
      if (!response.ok) throw new Error('Request failed');
    } catch {
      update(current);
      setError(`Could not remove that ${kind === 'favorites' ? 'favourite' : 'reminder'}.`);
    }
  };

  const renderMatchList = (kind: 'favorites' | 'reminders', items: MatchResource[]) => (
    <div className="space-y-3">
      {items.length === 0 && (
        <p className="rounded-lg bg-surface-container-low px-4 py-5 text-sm text-on-surface-variant">
          No {kind === 'favorites' ? 'favourite matches' : 'active reminders'} yet.
        </p>
      )}
      {items.map((item) => (
        <div key={item.matchId} className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/20 p-4">
          <Link prefetch={false} href={`/match/${item.match.id}`} className="min-w-0">
            <p className="font-headline text-sm font-bold text-primary">
              {item.match.homeTeam.name} v {item.match.awayTeam.name}
            </p>
            <p className="mt-1 font-label text-[11px] text-on-surface-variant">
              {formatMatchDateTime(item.match.scheduledAt)}
              {item.match.status === 'COMPLETED' && ` · ${item.match.homeScore}-${item.match.awayScore}`}
            </p>
          </Link>
          <button
            type="button"
            onClick={() => removeMatchResource(kind, item)}
            className="min-h-11 shrink-0 rounded-lg px-3 font-label text-xs font-bold text-error"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );

  if (status === 'loading' || loading) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div role="status" className="animate-pulse space-y-4">
          <div className="h-8 bg-surface-container-high rounded w-1/3" />
          <div className="h-4 bg-surface-container-high rounded w-2/3" />
          <span className="sr-only">Loading settings</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="font-headline text-3xl font-black tracking-tighter uppercase text-primary-container">
          Settings
        </h1>
        <p className="font-body text-on-surface-variant mt-2">
          Signed in as {session?.user?.email}
        </p>
      </div>

      {error && <p role="alert" className="rounded-xl bg-error/5 px-5 py-4 text-sm text-error">{error}</p>}

      {/* My Teams */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/15">
        <h2 className="font-headline text-xl font-bold mb-2 flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-secondary">
            favorite
          </span>
          My Teams
        </h2>
        <p className="font-body text-sm text-on-surface-variant mb-6">
          Follow teams to see their fixtures first on the home page.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {allTeams.map((team) => (
            <button
              key={team.id}
              type="button"
              aria-pressed={followedIds.has(team.id)}
              disabled={pendingTeamId === team.id}
              onClick={() => toggleTeam(team.id)}
              className={`p-4 rounded-xl border-2 transition-all text-center disabled:opacity-60 ${
                followedIds.has(team.id)
                  ? 'border-secondary bg-secondary/10'
                  : 'border-outline-variant/30 hover:border-outline-variant'
              }`}
            >
              <TeamBadge team={team} size={48} className="mx-auto mb-2" />
              <p className="font-headline text-sm font-bold">{team.abbreviation}</p>
              <p className="font-label text-[10px] text-on-surface-variant">
                {team.name}
              </p>
              {followedIds.has(team.id) && (
                <span className="inline-block mt-2 text-secondary text-[10px] font-bold uppercase">
                  Following
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-6 shadow-sm">
        <h2 className="mb-4 font-headline text-xl font-bold">Favourite matches</h2>
        {renderMatchList('favorites', favorites)}
      </section>

      <section className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-6 shadow-sm">
        <h2 className="mb-2 font-headline text-xl font-bold">Match reminders</h2>
        <p className="mb-4 text-sm text-on-surface-variant">These are in-app reminders. Browser push is not enabled yet.</p>
        {renderMatchList('reminders', reminders)}
      </section>

      {/* Notification preferences placeholder */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/15">
        <h2 className="font-headline text-xl font-bold mb-2 flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-secondary">
            notifications
          </span>
          Notifications
        </h2>
        <p className="font-body text-sm text-on-surface-variant">
          Match reminders stay in CentrePass for now. Browser push notifications are
          planned for a future update.
        </p>
      </section>
    </div>
  );
}
