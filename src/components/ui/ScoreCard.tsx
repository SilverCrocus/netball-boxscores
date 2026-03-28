import Link from 'next/link';
import { LiveIndicator } from './LiveIndicator';
import { TeamBadge } from './TeamBadge';
import { formatMatchDate, formatMatchTime, formatGameClock } from '@/lib/format';
import type { TeamInfo } from '@/types/team';

interface ScoreCardMatch {
  id: string;
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  homeScore: number;
  awayScore: number;
  status: 'SCHEDULED' | 'LIVE' | 'COMPLETED';
  currentQuarter?: number | null;
  currentTime?: string | null;
  round?: number;
  venue?: string;
  scheduledAt?: string | Date;
}

interface ScoreCardProps {
  match: ScoreCardMatch;
}

export function ScoreCard({ match }: ScoreCardProps) {
  const isLive = match.status === 'LIVE';
  const isCompleted = match.status === 'COMPLETED';
  const matchHref = isLive ? `/match/${match.id}/live` : `/match/${match.id}`;

  return (
    <Link
      href={matchHref}
      className={`block bg-surface-container-lowest rounded-xl p-6 shadow-sm relative overflow-hidden group transition-all hover:shadow-md ${
        isLive ? 'border-l-4 border-secondary' : 'border-l-4 border-transparent'
      }`}
    >
      {/* Status badge */}
      <div className="flex justify-between items-start mb-6">
        {isLive && match.currentQuarter && (
          <span className="bg-primary-container text-white px-3 py-1 rounded-full text-[10px] font-bold font-label tracking-widest uppercase">
            {(match.currentQuarter ?? 0) > 4 ? 'ET' : `Q${match.currentQuarter}`} {match.currentTime && `\u2022 ${formatGameClock(match.currentTime, match.currentQuarter)}`}
          </span>
        )}
        {isCompleted && (
          <span className="bg-surface-container-high text-on-surface-variant px-3 py-1 rounded-full text-[10px] font-bold font-label tracking-widest uppercase">
            Final
          </span>
        )}
        {match.status === 'SCHEDULED' && match.scheduledAt && (
          <span className="text-[10px] font-bold text-on-surface-variant uppercase font-label">
            {formatMatchTime(match.scheduledAt)}
          </span>
        )}
        {isLive && <LiveIndicator />}
      </div>

      {/* Score display */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col items-center flex-1 text-center">
          <TeamBadge team={match.homeTeam} size={48} variant="home" className="mb-2" />
          <span className="text-sm font-bold font-headline text-primary uppercase">
            {match.homeTeam.name}
          </span>
        </div>

        <div className="flex items-center gap-4 text-4xl font-black font-headline text-primary tracking-tighter">
          <span>{match.homeScore}</span>
          <span className="text-outline-variant text-2xl">-</span>
          <span>{match.awayScore}</span>
        </div>

        <div className="flex flex-col items-center flex-1 text-center">
          <TeamBadge team={match.awayTeam} size={48} variant="away" className="mb-2" />
          <span className="text-sm font-bold font-headline text-primary uppercase">
            {match.awayTeam.name}
          </span>
        </div>
      </div>

      {/* Footer */}
      {(match.round || match.venue) && (
        <div className="mt-6 pt-4 border-t border-surface-container flex justify-between items-center">
          <span className="text-[10px] font-medium text-on-surface-variant uppercase font-label">
            {match.scheduledAt && formatMatchDate(match.scheduledAt)}
            {match.round && ` \u2022 Round ${match.round}`}
            {match.venue && ` \u2022 ${match.venue}`}
          </span>
          <span className="text-secondary font-bold text-xs flex items-center gap-1 group-hover:gap-2 transition-all">
            {isLive ? 'See Live Stats' : 'View Stats'}
            <span className="material-symbols-outlined text-sm">chevron_right</span>
          </span>
        </div>
      )}
    </Link>
  );
}
