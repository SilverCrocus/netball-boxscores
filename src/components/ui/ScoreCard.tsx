import Link from 'next/link';
import { LiveIndicator } from './LiveIndicator';
import { TeamBadge } from './TeamBadge';
import { formatMatchDate, formatMatchTime, formatGameClock, formatMatchDateTime } from '@/lib/format';
import type { TeamInfo } from '@/types/team';
import { formatMatchStage } from '@/lib/match-label';
import type { MatchStatus } from '@prisma/client';
import { matchHref as canonicalMatchHref } from '@/lib/edition-links';

interface ScoreBreakdown {
  goals: number;
  superShots: number;
}

interface ScoreCardMatch {
  id: string;
  competitionId?: string;
  href?: string;
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  homeScore: number | null;
  awayScore: number | null;
  status: MatchStatus;
  scoreAvailable: boolean;
  currentQuarter?: number | null;
  currentTime?: string | null;
  round?: number | null;
  roundLabel?: string | null;
  stageName?: string | null;
  finalCode?: string | null;
  venue?: string;
  scheduledAt?: string | Date;
  homeBreakdown?: ScoreBreakdown | null;
  awayBreakdown?: ScoreBreakdown | null;
}

interface ScoreCardProps {
  match: ScoreCardMatch;
  showFinalBadge?: boolean;
}

function scoreCardHref(match: ScoreCardMatch, isLive: boolean): string {
  if (match.href) return match.href;
  if (!match.competitionId) {
    throw new Error(`ScoreCard match ${match.id} is missing its canonical edition`);
  }
  return canonicalMatchHref(match.id, match.competitionId, isLive ? 'live' : '');
}

export function ScoreCard({ match, showFinalBadge = true }: ScoreCardProps) {
  const isLive = match.status === 'LIVE' && match.scoreAvailable;
  const isCompletedStatus = match.status === 'COMPLETED';
  const isCompleted = isCompletedStatus && match.scoreAvailable;
  const matchHref = scoreCardHref(match, isLive);
  const homeScore = match.homeScore ?? 0;
  const awayScore = match.awayScore ?? 0;
  const homeWon = isCompleted && homeScore > awayScore;
  const awayWon = isCompleted && awayScore > homeScore;
  const hasStageContext = match.round != null
    || Boolean(match.finalCode || match.roundLabel || match.stageName);
  const stageLabel = hasStageContext
    ? formatMatchStage(match.round, match.finalCode, match.roundLabel, match.stageName)
    : null;

  return (
    <Link
      href={matchHref}
      prefetch={false}
      className={`flex h-full min-w-0 flex-col overflow-hidden rounded-xl bg-surface-container-lowest p-4 shadow-sm transition-all group relative hover:shadow-md sm:p-6 ${
        isLive ? 'border-l-4 border-secondary' : 'border-l-4 border-transparent'
      }`}
    >
      {/* Status badge */}
      <div className="mb-5 flex min-w-0 items-start justify-between gap-2 sm:mb-6">
        {isLive && match.currentQuarter && (
          <span className="bg-primary-container text-white px-3 py-1 rounded-full text-[10px] font-bold font-label tracking-widest uppercase">
            {(match.currentQuarter ?? 0) > 4 ? 'ET' : `Q${match.currentQuarter}`} {match.currentTime && `\u2022 ${formatGameClock(match.currentTime, match.currentQuarter)}`}
          </span>
        )}
        {isCompleted && showFinalBadge && (
          <span className="bg-surface-container-high text-on-surface-variant px-3 py-1 rounded-full text-[10px] font-bold font-label tracking-widest uppercase">
            Final
          </span>
        )}
        {isCompletedStatus && !isCompleted && showFinalBadge && (
          <span className="bg-surface-container-high text-on-surface-variant px-3 py-1 rounded-full text-[10px] font-bold font-label tracking-widest uppercase">
            Result pending
          </span>
        )}
        {isCompletedStatus && !showFinalBadge && match.scheduledAt && (
          <span className="text-[10px] font-bold text-on-surface-variant uppercase font-label">
            {formatMatchDateTime(match.scheduledAt)}
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
      <div data-testid="score-display" className="flex-1 flex flex-col justify-center">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-4">
          <div className="flex min-w-0 flex-col items-center text-center">
            <TeamBadge team={match.homeTeam} size={48} variant="home" className="mb-2" />
            <span className="w-full text-xs font-bold font-headline leading-tight text-primary uppercase break-words [overflow-wrap:anywhere] sm:text-sm">
              {match.homeTeam.name}
            </span>
          </div>

          {isLive || isCompleted ? (
          <div className="flex items-center gap-1 text-3xl font-black font-headline tracking-tighter sm:gap-3 sm:text-4xl">
            <div className="flex flex-col items-center">
              <span className={homeWon ? 'text-secondary' : awayWon ? 'text-slate-400' : 'text-primary'}>{homeScore}</span>
              {match.homeBreakdown && match.homeBreakdown.superShots > 0 && (
                <span className="font-label text-[10px] text-on-surface-variant/60 font-medium mt-[-2px]">
                  ({match.homeBreakdown.goals}.{match.homeBreakdown.superShots})
                </span>
              )}
            </div>
            <span className="text-outline-variant text-2xl">-</span>
            <div className="flex flex-col items-center">
              <span className={awayWon ? 'text-secondary' : homeWon ? 'text-slate-400' : 'text-primary'}>{awayScore}</span>
              {match.awayBreakdown && match.awayBreakdown.superShots > 0 && (
                <span className="font-label text-[10px] text-on-surface-variant/60 font-medium mt-[-2px]">
                  ({match.awayBreakdown.goals}.{match.awayBreakdown.superShots})
                </span>
              )}
            </div>
          </div>
          ) : (
            <span className="font-headline text-2xl font-black italic tracking-tight text-outline-variant sm:text-3xl">
              VS
            </span>
          )}

          <div className="flex min-w-0 flex-col items-center text-center">
            <TeamBadge team={match.awayTeam} size={48} variant="away" className="mb-2" />
            <span className="w-full text-xs font-bold font-headline leading-tight text-primary uppercase break-words [overflow-wrap:anywhere] sm:text-sm">
              {match.awayTeam.name}
            </span>
          </div>
        </div>
      </div>

      {/* Footer */}
      {(match.scheduledAt || stageLabel || match.venue) && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-surface-container pt-4">
          <span className="min-w-0 flex-1 text-[10px] font-medium text-on-surface-variant uppercase font-label break-words">
            {match.scheduledAt && formatMatchDate(match.scheduledAt)}
            {stageLabel && ` \u2022 ${stageLabel}`}
            {match.venue && ` \u2022 ${match.venue}`}
          </span>
          <span className="text-secondary font-bold text-xs flex items-center gap-1 group-hover:gap-2 transition-all">
            {isLive ? 'See Live Stats' : isCompleted ? 'View Stats' : 'Match details'}
            <span aria-hidden="true" className="material-symbols-outlined text-sm">chevron_right</span>
          </span>
        </div>
      )}
    </Link>
  );
}
