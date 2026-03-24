import Link from 'next/link';
import { TeamBadge } from '@/components/ui/TeamBadge';
import { formatShortDate } from '@/lib/format';
import type { PositionConfig } from './position-config';

interface MatchTeam {
  id: string;
  name: string;
  abbreviation: string;
  logoUrl: string | null;
}

interface MatchWithTeams {
  id: string;
  scheduledAt: Date;
  homeScore: number;
  awayScore: number;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
}

interface MatchStat {
  id: string;
  goals: number;
  attempts: number;
  goalAssists: number;
  intercepts: number;
  deflections: number;
  rebounds: number;
  penalties: number;
  feeds: number;
  centrePassReceives: number;
  turnovers: number;
  minutesPlayed: number;
  match: MatchWithTeams;
}

interface PlayerGameLogProps {
  matchStats: MatchStat[];
  config: PositionConfig;
  playerTeamId: string;
}

function getStatValue(stat: MatchStat, statField: string): string {
  if (statField === 'shootingPct') {
    if (stat.attempts === 0) return '0%';
    return `${((stat.goals / stat.attempts) * 100).toFixed(0)}%`;
  }
  const value = stat[statField as keyof MatchStat];
  if (typeof value === 'number') return String(value);
  return '-';
}

export function PlayerGameLog({ matchStats, config, playerTeamId }: PlayerGameLogProps) {
  if (matchStats.length === 0) {
    return (
      <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-sm text-center">
        <span className="material-symbols-outlined text-4xl text-outline-variant mb-2 block">
          sports
        </span>
        <p className="font-body text-on-surface-variant">No match data available yet</p>
      </div>
    );
  }

  const statColumns = config.gameLogColumns.filter(
    (col) => !col.statField.startsWith('_')
  );

  return (
    <div className="bg-surface-container-lowest rounded-2xl overflow-hidden shadow-sm">
      <div className="px-8 py-6 border-b border-surface-container-low">
        <h2 className="font-headline text-2xl font-black text-primary uppercase tracking-tight">
          Recent Game Log
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-surface-container-low text-[10px] uppercase tracking-[0.2em] font-black text-on-surface-variant">
              <th className="px-8 py-4">Date</th>
              <th className="px-8 py-4">Opponent</th>
              <th className="px-8 py-4">Result</th>
              {statColumns.map((col) => (
                <th key={col.key} className="px-8 py-4 text-center">
                  {col.abbrev}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-label text-sm">
            {matchStats.map((stat, index) => {
              const { match } = stat;
              const isHome = match.homeTeamId === playerTeamId;
              const opponent = isHome ? match.awayTeam : match.homeTeam;
              const playerScore = isHome ? match.homeScore : match.awayScore;
              const opponentScore = isHome ? match.awayScore : match.homeScore;
              const isWin = playerScore > opponentScore;
              const isDraw = playerScore === opponentScore;
              const resultLabel = isDraw ? 'D' : isWin ? 'W' : 'L';
              const resultBg = isDraw
                ? 'bg-outline-variant/10 text-outline-variant'
                : isWin
                  ? 'bg-secondary/10 text-secondary'
                  : 'bg-error/10 text-error';

              return (
                <tr
                  key={stat.id}
                  className={`hover:bg-surface-container-low/50 transition-colors ${
                    index > 0 ? 'border-t border-surface-container-low' : ''
                  }`}
                >
                  <td className="px-8 py-5 text-on-surface font-semibold">
                    <Link href={`/match/${match.id}`} className="hover:text-secondary transition-colors">
                      {formatShortDate(match.scheduledAt)}
                    </Link>
                  </td>
                  <td className="px-8 py-5">
                    <Link href={`/match/${match.id}`} className="flex items-center gap-2 hover:text-secondary transition-colors">
                      <TeamBadge team={opponent} size={24} />
                      <span className="font-bold">{opponent.name}</span>
                    </Link>
                  </td>
                  <td className="px-8 py-5">
                    <Link href={`/match/${match.id}`}>
                      <span className={`px-2 py-0.5 rounded font-black ${resultBg}`}>
                        {resultLabel} {playerScore}-{opponentScore}
                      </span>
                    </Link>
                  </td>
                  {statColumns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-8 py-5 text-center ${
                        col.format === 'percentage'
                          ? 'font-headline text-secondary font-black'
                          : col.key === config.primaryChartStat
                            ? 'font-bold text-primary'
                            : ''
                      }`}
                    >
                      {getStatValue(stat, col.statField)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
