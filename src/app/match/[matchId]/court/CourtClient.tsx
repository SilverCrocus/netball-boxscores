'use client';

import { useMatchSocket } from '@/hooks/useMatchSocket';
import { NetballCourt } from '@/components/match/NetballCourt';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import type { MatchStatus, Position } from '@prisma/client';
import type { StatsUpdatePayload } from '@/types/socket';

export interface CourtPlayerDto {
  id: string;
  name: string;
  position: Position;
  teamId: string;
  matchStats: Array<{ turnovers: number }>;
}

export interface CourtMatchDto {
  id: string;
  status: MatchStatus;
  homeScore: number;
  awayScore: number;
  currentQuarter: number | null;
  currentTime: string | null;
  homeTeam: { name: string; players: CourtPlayerDto[] };
  awayTeam: { name: string; players: CourtPlayerDto[] };
}

interface CourtClientProps {
  match: CourtMatchDto;
  realtimeEnabled?: boolean;
}

const VALID_POSITIONS = new Set(['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK']);

function livePosition(
  player: CourtPlayerDto,
  stats: StatsUpdatePayload | null,
): CourtPlayerDto {
  const position = stats?.playerStats.find((item) => item.playerId === player.id)?.currentPosition;
  return position && VALID_POSITIONS.has(position)
    ? { ...player, position: position as Position }
    : player;
}

export function CourtClient({ match, realtimeEnabled = false }: CourtClientProps) {
  const { score, playerStats, matchStatus } = useMatchSocket(match.id, realtimeEnabled);

  const homeScore = score?.homeScore ?? match.homeScore;
  const awayScore = score?.awayScore ?? match.awayScore;
  const effectiveStatus = matchStatus?.status ?? match.status;
  const isLive = effectiveStatus === 'LIVE';
  const quarter = score?.currentQuarter ?? match.currentQuarter;
  const time = score?.currentTime ?? match.currentTime;
  const homePlayers = match.homeTeam.players.map((player) => livePosition(player, playerStats));
  const awayPlayers = match.awayTeam.players.map((player) => livePosition(player, playerStats));
  const turnovers = (players: typeof match.homeTeam.players) => players.reduce((sum, player) => {
    const liveStats = playerStats?.playerStats.find((item) => item.playerId === player.id);
    return sum + (liveStats?.turnovers ?? player.matchStats[0]?.turnovers ?? 0);
  }, 0);

  return (
    <section className="pt-24 px-4 md:px-8 max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-12 gap-8 mb-12">
      {/* Header */}
      <div className="xl:col-span-12 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          {isLive && (
            <div className="inline-flex items-center gap-2 bg-secondary/20 text-secondary px-3 py-1 rounded-full mb-4">
              <LiveIndicator />
              <span className="text-xs font-bold uppercase tracking-widest font-headline">
                Live Tracking
              </span>
            </div>
          )}
          <h1 className="text-4xl md:text-6xl font-black font-headline tracking-tighter uppercase text-primary-container">
            Court Visualizer
          </h1>
        </div>
      </div>

      {/* Court */}
      <div className="xl:col-span-8">
        <NetballCourt
          homePlayers={homePlayers}
          awayPlayers={awayPlayers}
        />
      </div>

      {/* Sidebar widgets */}
      <aside className="xl:col-span-4 flex flex-col gap-6">
        {/* Scoreboard widget */}
        <div className="bg-primary-container rounded-3xl p-6 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-secondary/10 rounded-full -translate-y-12 translate-x-12 blur-3xl" />
          <div className="flex justify-between items-center mb-8 relative">
            <span className="text-xs font-black tracking-widest text-lime-400 uppercase font-headline">
              {quarter ? `Quarter ${quarter}` : ''} {time ? `- ${time}` : ''}
            </span>
            {isLive && (
              <span className="bg-red-600 text-white text-[10px] px-2 py-0.5 rounded font-bold font-headline animate-pulse">
                LIVE
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 mb-6 relative">
            <div className="flex flex-col items-center text-center">
              <p className="text-on-primary-container text-xs font-bold uppercase font-headline tracking-tight">
                {match.homeTeam.name}
              </p>
              <p className="text-5xl font-black text-white font-headline mt-1">
                {homeScore}
              </p>
            </div>
            <div className="flex flex-col items-center text-center">
              <p className="text-on-primary-container text-xs font-bold uppercase font-headline tracking-tight">
                {match.awayTeam.name}
              </p>
              <p className="text-5xl font-black text-white font-headline mt-1">
                {awayScore}
              </p>
            </div>
          </div>
        </div>

        {/* Key stats bento */}
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Goals', home: homeScore, away: awayScore },
            {
              label: 'Turnovers',
              home: turnovers(match.homeTeam.players),
              away: turnovers(match.awayTeam.players),
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-surface-container-lowest rounded-3xl p-5 shadow-sm"
            >
              <p className="text-[10px] font-bold text-on-surface-variant uppercase font-headline tracking-widest mb-1">
                {stat.label}
              </p>
              <p className="text-2xl font-black text-primary font-headline">
                {stat.home} - {stat.away}
              </p>
            </div>
          ))}
        </div>
      </aside>
    </section>
  );
}
