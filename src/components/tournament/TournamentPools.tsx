import { TeamBadge } from '@/components/ui/TeamBadge';
import type { TournamentPool } from '@/lib/tournament/types';

interface TournamentPoolsProps {
  pools: TournamentPool[];
}
export function TournamentPools({ pools }: TournamentPoolsProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {pools.map((pool) => (
        <section
          key={pool.id}
          aria-labelledby={`${pool.id}-heading`}
          className="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-lg"
        >
          <header className="kinetic-gradient flex items-center justify-between gap-4 px-5 py-5 text-white sm:px-6">
            <div>
              <p className="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-secondary-fixed">
                Group {String(pool.sequence).padStart(2, '0')}
              </p>
              <h3 id={`${pool.id}-heading`} className="mt-1 font-headline text-2xl font-black uppercase">
                {pool.name}
              </h3>
            </div>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 font-label text-xs font-bold">
              {pool.teams.length} teams
            </span>
          </header>

          <ol className="divide-y divide-surface-container" aria-label={`${pool.name} teams by tournament seed`}>
            {pool.teams.map((team, index) => (
              <li
                key={team.entryId}
                className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 px-4 py-4 transition-colors hover:bg-surface-container-low sm:gap-4 sm:px-6"
              >
                <span className="w-7 text-center font-headline text-sm font-black text-on-surface-variant">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <TeamBadge team={team} size={42} variant={index % 2 === 0 ? 'home' : 'away'} />
                <span className="min-w-0">
                  <span className="block truncate font-headline text-base font-bold text-primary sm:text-lg">
                    {team.displayName}
                  </span>
                  <span className="mt-0.5 block font-label text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-variant">
                    {team.abbreviation}
                  </span>
                </span>
                <span className="rounded-lg bg-surface-container px-2.5 py-1.5 text-right">
                  <span className="block font-label text-[9px] font-bold uppercase tracking-wider text-on-surface-variant">
                    Seed
                  </span>
                  <span className="block font-headline text-sm font-black text-secondary">
                    {team.seed ?? '—'}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
