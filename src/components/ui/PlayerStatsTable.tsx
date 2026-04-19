import Image from 'next/image';
import Link from 'next/link';
import type { PlayerStatRow } from '@/types/stats';
import { computeShootingPct } from '@/lib/stat-utils';
import { TeamBadge } from '@/components/ui/TeamBadge';

interface PlayerStatWithPhoto extends PlayerStatRow {
  playerId?: string;
  photoUrl?: string | null;
}

interface StatsTeam {
  name: string;
  abbreviation: string;
  logoUrl: string | null;
}

interface PlayerStatsTableProps {
  team: StatsTeam;
  players: PlayerStatWithPhoto[];
}

export function PlayerStatsTable({ team, players }: PlayerStatsTableProps) {

  return (
    <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/10">
      <div className="bg-primary-container px-6 py-4 flex items-center gap-3">
        <TeamBadge team={team} size={32} variant="home" />
        <h3 className="text-white font-headline font-bold text-lg tracking-tight uppercase">
          {team.name}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-low border-b border-outline-variant/20">
              <th className="px-6 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest">
                Player Name
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-center">
                Pos
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Goals
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Shots
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Shoot %
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Inter
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Deflect
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Reb
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/10">
            {players.map((player) => {
              const pct = player.attempts > 0 ? Math.round(computeShootingPct(player.goals, player.attempts)) : null;
              return (
                <tr key={player.id} className="hover:bg-surface-container/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {player.photoUrl ? (
                        <Image
                          src={player.photoUrl}
                          alt={player.name}
                          width={32}
                          height={32}
                          className="rounded-full object-cover w-8 h-8 shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary-container/20 flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-bold text-primary-container">
                            {player.name.split(' ').map((n) => n[0]).join('')}
                          </span>
                        </div>
                      )}
                      {player.playerId ? (
                        <Link href={`/player/${player.playerId}`} className="font-bold font-headline text-primary-container text-sm hover:underline">
                          {player.name}
                        </Link>
                      ) : (
                        <p className="font-bold font-headline text-primary-container text-sm">
                          {player.name}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="bg-primary-container text-white text-[10px] font-bold px-1.5 py-0.5 rounded font-label">
                      {player.position}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right font-black font-headline text-primary-container">
                    {player.goals}
                  </td>
                  <td className="px-4 py-4 text-right font-medium text-on-surface-variant">
                    {player.attempts}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {pct !== null ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="font-bold text-secondary">{pct}%</span>
                        <div className="w-12 bg-surface-container-high h-1 rounded-full overflow-hidden">
                          <div className="bg-secondary h-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    ) : (
                      <span className="font-bold text-outline">-</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right font-label font-semibold">
                    {player.intercepts}
                  </td>
                  <td className="px-4 py-4 text-right font-label font-semibold text-on-surface-variant">
                    {player.deflections}
                  </td>
                  <td className="px-4 py-4 text-right font-label font-semibold text-secondary">
                    {player.rebounds}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
