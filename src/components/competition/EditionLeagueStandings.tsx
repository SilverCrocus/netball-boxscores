import Link from 'next/link';
import { TeamBadge } from '@/components/ui/TeamBadge';

interface LeagueStandingRow {
  id: string;
  rank: number;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  goalsFor: number;
  goalsAgainst: number;
  goalPercentage: number;
  points: number;
  team: {
    name: string;
    slug: string;
    abbreviation: string;
    logoUrl: string | null;
  };
}

interface EditionLeagueStandingsProps {
  competitionId: string;
  editionLabel: string;
  standings: LeagueStandingRow[];
}

export function EditionLeagueStandings({
  competitionId,
  editionLabel,
  standings,
}: EditionLeagueStandingsProps) {
  return (
    <div>
      <section className="mb-10 rounded-3xl bg-primary px-6 py-10 text-white shadow-xl sm:px-10 md:py-14">
        <p className="font-label text-xs font-bold uppercase tracking-[0.2em] text-primary-fixed-dim">
          Season {editionLabel}
        </p>
        <h2 className="mt-3 font-headline text-4xl font-black uppercase tracking-tight sm:text-5xl md:text-6xl">
          League Standings
        </h2>
        <p className="mt-4 max-w-2xl font-body text-base text-white/75 sm:text-lg">
          The official edition ladder, including match record, goal percentage and competition points.
        </p>
      </section>

      {standings.length === 0 ? (
        <section className="rounded-2xl border border-outline-variant bg-surface-container-low p-8 text-center">
          <h3 className="font-headline text-xl font-bold text-primary">No standings available</h3>
          <p className="mt-2 font-body text-sm text-on-surface-variant">
            The ladder has not been published for this edition yet.
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-xl" aria-label={`${editionLabel} league standings`}>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-left">
              <thead className="bg-surface-container-high font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant">
                <tr>
                  <th className="px-5 py-4">Rank</th>
                  <th className="px-5 py-4">Team</th>
                  <th className="px-3 py-4 text-center" title="Games played">GP</th>
                  <th className="px-3 py-4 text-center" title="Wins">W</th>
                  <th className="px-3 py-4 text-center" title="Losses">L</th>
                  <th className="px-3 py-4 text-center" title="Draws">D</th>
                  <th className="px-3 py-4 text-center" title="Goals for">GF</th>
                  <th className="px-3 py-4 text-center" title="Goals against">GA</th>
                  <th className="px-3 py-4 text-center" title="Goal percentage">G%</th>
                  <th className="px-5 py-4 text-right" title="Competition points">Pts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {standings.map((standing) => (
                  <tr key={standing.id} className="transition-colors hover:bg-surface-container-low">
                    <td className="px-5 py-5 font-headline text-xl font-black text-primary">
                      {String(standing.rank).padStart(2, '0')}
                    </td>
                    <td className="px-5 py-5">
                      <Link
                        href={`/team/${standing.team.slug}?edition=${encodeURIComponent(competitionId)}`}
                        prefetch={false}
                        className="flex items-center gap-3 font-headline font-bold text-primary hover:text-secondary"
                      >
                        <TeamBadge team={standing.team} size={42} variant="home" />
                        {standing.team.name}
                      </Link>
                    </td>
                    <td className="px-3 py-5 text-center font-headline font-bold">{standing.played}</td>
                    <td className="px-3 py-5 text-center font-headline font-bold text-secondary">{standing.wins}</td>
                    <td className="px-3 py-5 text-center font-headline font-bold text-error">{standing.losses}</td>
                    <td className="px-3 py-5 text-center font-headline font-bold">{standing.draws}</td>
                    <td className="px-3 py-5 text-center font-label">{standing.goalsFor}</td>
                    <td className="px-3 py-5 text-center font-label">{standing.goalsAgainst}</td>
                    <td className="px-3 py-5 text-center font-label font-bold">{standing.goalPercentage.toFixed(1)}%</td>
                    <td className="px-5 py-5 text-right font-headline text-xl font-black text-primary">{standing.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-surface-container md:hidden">
            {standings.map((standing) => (
              <Link
                key={standing.id}
                href={`/team/${standing.team.slug}?edition=${encodeURIComponent(competitionId)}`}
                prefetch={false}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-5"
              >
                <span className="font-headline text-2xl font-black text-primary">
                  {String(standing.rank).padStart(2, '0')}
                </span>
                <span className="flex min-w-0 items-center gap-3">
                  <TeamBadge team={standing.team} size={44} variant="home" />
                  <span className="min-w-0">
                    <span className="block truncate font-headline text-base font-bold text-primary">
                      {standing.team.name}
                    </span>
                    <span className="mt-1 block font-label text-[11px] font-semibold text-on-surface-variant">
                      {standing.played} GP · {standing.wins}-{standing.losses}-{standing.draws} · {standing.goalPercentage.toFixed(1)}%
                    </span>
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-headline text-2xl font-black text-primary">{standing.points}</span>
                  <span className="block font-label text-[10px] font-bold uppercase text-on-surface-variant">Pts</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
