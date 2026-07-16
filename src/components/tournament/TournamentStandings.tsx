import { TeamBadge } from '@/components/ui/TeamBadge';
import type { TournamentPoolStandings } from '@/lib/tournament/types';

interface TournamentStandingsProps {
  pools: TournamentPoolStandings[];
  hasAnyStandings: boolean;
}
const EMPTY_VALUE = '—';

function standingValue(value: number | undefined): number | string {
  return value ?? EMPTY_VALUE;
}

export function TournamentStandings({
  pools,
  hasAnyStandings,
}: TournamentStandingsProps) {
  return (
    <div className="space-y-6">
      {!hasAnyStandings ? (
        <aside
          role="status"
          className="flex gap-3 rounded-2xl border border-secondary/30 bg-secondary-container/20 px-4 py-4 text-on-surface sm:px-5"
        >
          <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-secondary">
            schedule
          </span>
          <div>
            <p className="font-headline text-sm font-bold text-primary">Pool standings begin with the tournament</p>
            <p className="mt-1 font-body text-sm leading-5 text-on-surface-variant">
              No official pool results have been recorded yet. Teams are listed by tournament seed; blank values are not zero scores.
            </p>
          </div>
        </aside>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {pools.map((pool) => (
          <section
            key={pool.id}
            aria-labelledby={`${pool.id}-standings-heading`}
            className="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-lg"
          >
            <header className="kinetic-gradient flex items-center justify-between px-5 py-4 text-white">
              <div>
                <p className="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary-fixed">
                  Pool table
                </p>
                <h3 id={`${pool.id}-standings-heading`} className="mt-1 font-headline text-xl font-black uppercase">
                  {pool.name}
                </h3>
              </div>
              <span className={`rounded-full px-3 py-1 font-label text-[10px] font-bold uppercase tracking-wider ${
                pool.hasStandings
                  ? 'bg-secondary text-on-secondary'
                  : 'border border-white/20 bg-white/10 text-primary-fixed-dim'
              }`}>
                {pool.hasStandings ? 'Official table' : 'Pre-event'}
              </span>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <caption className="sr-only">
                  {pool.hasStandings
                    ? `${pool.name} official standings`
                    : `${pool.name} entries in seed order before standings are available`}
                </caption>
                <thead className="bg-surface-container-low font-label text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-center">Pos</th>
                    <th scope="col" className="px-4 py-3">Team</th>
                    <th scope="col" className="px-2 py-3 text-center" title="Played">P</th>
                    <th scope="col" className="px-2 py-3 text-center" title="Wins">W</th>
                    <th scope="col" className="px-2 py-3 text-center" title="Draws">D</th>
                    <th scope="col" className="px-2 py-3 text-center" title="Losses">L</th>
                    <th scope="col" className="px-2 py-3 text-center" title="Goal percentage">G%</th>
                    <th scope="col" className="px-4 py-3 text-right" title="Points">Pts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {pool.rows.map((row) => (
                    <tr key={row.entryId} className="hover:bg-surface-container-low">
                      <td className="px-4 py-4 text-center font-headline text-lg font-black text-primary">
                        {standingValue(row.standing?.rank)}
                      </td>
                      <th scope="row" className="px-4 py-4">
                        <span className="flex items-center gap-3">
                          <TeamBadge team={row} size={36} variant="away" />
                          <span>
                            <span className="block max-w-44 truncate font-headline text-sm font-bold text-primary">
                              {row.displayName}
                            </span>
                            <span className="block font-label text-[9px] font-bold uppercase tracking-wider text-on-surface-variant">
                              Seed {row.seed ?? EMPTY_VALUE}
                            </span>
                          </span>
                        </span>
                      </th>
                      <td className="px-2 py-4 text-center font-headline text-sm font-bold text-on-surface">
                        {standingValue(row.standing?.played)}
                      </td>
                      <td className="px-2 py-4 text-center font-headline text-sm font-bold text-secondary">
                        {standingValue(row.standing?.wins)}
                      </td>
                      <td className="px-2 py-4 text-center font-headline text-sm font-bold text-on-surface-variant">
                        {standingValue(row.standing?.draws)}
                      </td>
                      <td className="px-2 py-4 text-center font-headline text-sm font-bold text-error">
                        {standingValue(row.standing?.losses)}
                      </td>
                      <td className="px-2 py-4 text-center font-label text-xs font-bold text-on-surface">
                        {row.standing ? `${row.standing.goalPercentage.toFixed(1)}%` : EMPTY_VALUE}
                      </td>
                      <td className="px-4 py-4 text-right font-headline text-lg font-black text-primary">
                        {standingValue(row.standing?.points)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
