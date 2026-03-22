import Link from 'next/link';
import { LiveIndicator } from './LiveIndicator';

interface TeamInfo {
  name: string;
  abbreviation: string;
  logoUrl?: string | null;
}

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

  return (
    <Link
      href={`/match/${match.id}`}
      className={`block bg-surface-container-lowest rounded-xl p-6 shadow-sm relative overflow-hidden group transition-all hover:shadow-md ${
        isLive ? 'border-l-4 border-secondary' : 'border-l-4 border-transparent'
      }`}
    >
      {/* Status badge */}
      <div className="flex justify-between items-start mb-6">
        {isLive && match.currentQuarter && (
          <span className="bg-primary-container text-on-primary-fixed-variant px-3 py-1 rounded-full text-[10px] font-bold font-label tracking-widest uppercase">
            Q{match.currentQuarter} {match.currentTime && `\u2022 ${match.currentTime}`}
          </span>
        )}
        {isCompleted && (
          <span className="bg-surface-container-high text-on-surface-variant px-3 py-1 rounded-full text-[10px] font-bold font-label tracking-widest uppercase">
            Final
          </span>
        )}
        {match.status === 'SCHEDULED' && match.scheduledAt && (
          <span className="text-[10px] font-bold text-on-surface-variant uppercase font-label">
            {new Date(match.scheduledAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        {isLive && <LiveIndicator />}
      </div>

      {/* Score display */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col items-center flex-1 text-center">
          <div className="w-12 h-12 bg-primary-container rounded-lg flex items-center justify-center text-white font-black italic text-lg font-headline mb-2">
            {match.homeTeam.abbreviation.charAt(0)}
          </div>
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
          <div className="w-12 h-12 bg-surface-container-high rounded-lg flex items-center justify-center text-primary font-black italic text-lg font-headline mb-2">
            {match.awayTeam.abbreviation.charAt(0)}
          </div>
          <span className="text-sm font-bold font-headline text-primary uppercase">
            {match.awayTeam.name}
          </span>
        </div>
      </div>

      {/* Footer */}
      {(match.round || match.venue) && (
        <div className="mt-6 pt-4 border-t border-surface-container flex justify-between items-center">
          <span className="text-[10px] font-medium text-on-surface-variant uppercase font-label">
            {match.round && `Round ${match.round}`} {match.venue && `\u2022 ${match.venue}`}
          </span>
          <span className="text-secondary font-bold text-xs flex items-center gap-1 group-hover:gap-2 transition-all">
            View Stats
            <span className="material-symbols-outlined text-sm">chevron_right</span>
          </span>
        </div>
      )}
    </Link>
  );
}
