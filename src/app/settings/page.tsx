'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

interface TeamFollow {
  teamId: string;
  team: { id: string; name: string; abbreviation: string; logoUrl: string | null };
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const [followedTeams, setFollowedTeams] = useState<TeamFollow[]>([]);
  const [allTeams, setAllTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [teamsRes, followsRes] = await Promise.all([
        fetch('/api/teams'),
        fetch('/api/user/teams'),
      ]);
      if (teamsRes.ok) setAllTeams(await teamsRes.json());
      if (followsRes.ok) setFollowedTeams(await followsRes.json());
      setLoading(false);
    }
    load();
  }, []);

  const followedIds = new Set(followedTeams.map((ft) => ft.teamId));

  const toggleTeam = async (teamId: string) => {
    if (followedIds.has(teamId)) {
      await fetch('/api/user/teams', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      });
      setFollowedTeams((prev) => prev.filter((ft) => ft.teamId !== teamId));
    } else {
      const res = await fetch('/api/user/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      });
      if (res.ok) {
        const team = allTeams.find((t) => t.id === teamId);
        setFollowedTeams((prev) => [...prev, { teamId, team }]);
      }
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-surface-container-high rounded w-1/3" />
          <div className="h-4 bg-surface-container-high rounded w-2/3" />
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

      {/* My Teams */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/15">
        <h2 className="font-headline text-xl font-bold mb-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary">
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
              onClick={() => toggleTeam(team.id)}
              className={`p-4 rounded-xl border-2 transition-all text-center ${
                followedIds.has(team.id)
                  ? 'border-secondary bg-secondary/10'
                  : 'border-outline-variant/30 hover:border-outline-variant'
              }`}
            >
              {team.logoUrl && (
                <img
                  src={team.logoUrl}
                  alt={team.name}
                  className="w-12 h-12 mx-auto mb-2 object-contain"
                />
              )}
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

      {/* Notification preferences placeholder */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/15">
        <h2 className="font-headline text-xl font-bold mb-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary">
            notifications
          </span>
          Notifications
        </h2>
        <p className="font-body text-sm text-on-surface-variant">
          In-app match reminders are enabled for your followed teams. Browser push
          notifications coming in a future update.
        </p>
      </section>
    </div>
  );
}
