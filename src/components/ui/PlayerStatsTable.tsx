import Link from 'next/link';
import type { PlayerStatRow } from '@/types/stats';
import { computeShootingPct } from '@/lib/stat-utils';
import { TeamBadge } from '@/components/ui/TeamBadge';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { StatsLegend } from '@/components/ui/StatsLegend';

interface PlayerStatWithPhoto extends PlayerStatRow {
  playerId?: string;
  photoUrl?: string | null;
  superShots?: number;
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

type StatCategory = 'attack' | 'defence' | 'general';

const CATEGORY_HEADER_COLORS: Record<StatCategory, string> = {
  attack: 'text-secondary',
  defence: 'text-cyan-600',
  general: 'text-on-surface-variant',
};

const CATEGORY_CELL_COLORS: Record<StatCategory, string> = {
  attack: 'text-secondary',
  defence: 'text-cyan-700',
  general: 'text-on-surface-variant',
};

interface ColumnDef {
  abbr: string;
  title: string;
  category: StatCategory;
}

const COLUMNS: ColumnDef[] = [
  { abbr: 'MIN', title: 'Minutes Played', category: 'general' },
  { abbr: 'G', title: 'Goals — total goals (super shots in brackets)', category: 'attack' },
  { abbr: 'ATT', title: 'Attempts — shots at goal', category: 'attack' },
  { abbr: 'G%', title: 'Goal Percentage — goals ÷ attempts', category: 'attack' },
  { abbr: 'AST', title: 'Goal Assists — pass to the shooter who scores', category: 'attack' },
  { abbr: 'FD', title: 'Feeds — passes into the goal circle', category: 'attack' },
  { abbr: 'CPR', title: 'Centre Pass Receives — first pass after a centre pass', category: 'attack' },
  { abbr: 'INT', title: 'Intercepts — gains possession from opponent\'s pass', category: 'defence' },
  { abbr: 'DEF', title: 'Deflections — touches the ball without gaining possession', category: 'defence' },
  { abbr: 'REB', title: 'Rebounds — retrieves ball after a missed shot', category: 'defence' },
  { abbr: 'PEN', title: 'Penalties — penalties conceded (contact, obstruction, etc.)', category: 'general' },
  { abbr: 'TO', title: 'Turnovers — loses possession to the other team', category: 'general' },
];

const TD_BASE = 'px-3 py-3 text-right font-label text-sm';

export function PlayerStatsTable({ team, players }: PlayerStatsTableProps) {

  return (
    <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/10">
      <div className="bg-primary-container px-6 py-4 flex items-center gap-3">
        <TeamBadge team={team} size={32} variant="home" />
        <h3 className="text-white font-headline font-bold text-lg tracking-tight uppercase">
          {team.name}
        </h3>
      </div>
      <StatsLegend />
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-low border-b border-outline-variant/20">
              <th className="px-4 py-3 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest sticky left-0 bg-surface-container-low z-10 min-w-[160px]">
                Player
              </th>
              <th className="px-2 py-3 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-center sticky left-[160px] bg-surface-container-low z-10">
                Pos
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.abbr}
                  title={col.title}
                  className={`px-3 py-3 text-[10px] font-bold font-label uppercase tracking-widest text-right whitespace-nowrap cursor-default ${CATEGORY_HEADER_COLORS[col.category]}`}
                >
                  {col.abbr}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/10">
            {players.map((player) => {
              const pct = player.attempts > 0 ? Math.round(computeShootingPct(player.goals, player.attempts)) : null;
              return (
                <tr key={player.id} className="hover:bg-surface-container/50 transition-colors">
                  <td className="px-4 py-3 sticky left-0 bg-surface-container-lowest z-10">
                    <div className="flex items-center gap-2">
                      <PlayerAvatar name={player.name} photoUrl={player.photoUrl} size={28} />
                      {player.playerId ? (
                        <Link href={`/player/${player.playerId}`} className="font-bold font-headline text-primary-container text-sm hover:underline truncate max-w-[110px]">
                          {player.name}
                        </Link>
                      ) : (
                        <p className="font-bold font-headline text-primary-container text-sm truncate max-w-[110px]">
                          {player.name}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-3 text-center sticky left-[160px] bg-surface-container-lowest z-10">
                    <span className="bg-primary-container text-white text-[10px] font-bold px-1.5 py-0.5 rounded font-label">
                      {player.position}
                    </span>
                  </td>
                  {/* MIN */}
                  <td className={`${TD_BASE} ${CATEGORY_CELL_COLORS.general}`}>
                    {Math.round(player.minutesPlayed)}
                  </td>
                  {/* G */}
                  <td className={`${TD_BASE} font-black font-headline ${CATEGORY_CELL_COLORS.attack}`}>
                    {player.goals}
                    {player.superShots ? (
                      <span className="text-amber-600 font-bold text-[10px] ml-0.5">({player.superShots})</span>
                    ) : null}
                  </td>
                  {/* ATT */}
                  <td className={`${TD_BASE} ${CATEGORY_CELL_COLORS.attack}`}>
                    {player.attempts}
                  </td>
                  {/* G% */}
                  <td className={TD_BASE}>
                    {pct !== null ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <span className={`font-bold ${CATEGORY_CELL_COLORS.attack}`}>{pct}%</span>
                        <div className="w-8 bg-surface-container-high h-1 rounded-full overflow-hidden">
                          <div className="bg-secondary h-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    ) : (
                      <span className="text-outline">-</span>
                    )}
                  </td>
                  {/* AST */}
                  <td className={`${TD_BASE} font-semibold ${CATEGORY_CELL_COLORS.attack}`}>
                    {player.goalAssists}
                  </td>
                  {/* FD */}
                  <td className={`${TD_BASE} ${CATEGORY_CELL_COLORS.attack}`}>
                    {player.feeds}
                  </td>
                  {/* CPR */}
                  <td className={`${TD_BASE} ${CATEGORY_CELL_COLORS.attack}`}>
                    {player.centrePassReceives}
                  </td>
                  {/* INT */}
                  <td className={`${TD_BASE} font-semibold ${CATEGORY_CELL_COLORS.defence}`}>
                    {player.intercepts}
                  </td>
                  {/* DEF */}
                  <td className={`${TD_BASE} ${CATEGORY_CELL_COLORS.defence}`}>
                    {player.deflections}
                  </td>
                  {/* REB */}
                  <td className={`${TD_BASE} font-semibold ${CATEGORY_CELL_COLORS.defence}`}>
                    {player.rebounds}
                  </td>
                  {/* PEN */}
                  <td className={`${TD_BASE} ${CATEGORY_CELL_COLORS.general}`}>
                    {player.penalties}
                  </td>
                  {/* TO */}
                  <td className={`${TD_BASE} ${CATEGORY_CELL_COLORS.general}`}>
                    {player.turnovers}
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
