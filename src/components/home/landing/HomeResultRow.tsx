import Link from 'next/link';
import { TeamBadge } from '@/components/ui/TeamBadge';
import { matchHref } from '@/lib/edition-links';
import type { HomeResultCard } from '@/lib/home-feed';

interface HomeResultRowProps {
  match: HomeResultCard;
  timezone?: string;
}

const DEFAULT_TIMEZONE = 'Australia/Sydney';

function resultHref(match: HomeResultCard): string {
  if (match.href) return match.href;
  if (match.competitionId) return matchHref(match.id, match.competitionId);
  return `/match/${encodeURIComponent(match.id)}`;
}

function formatResultDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: timezone,
  }).format(new Date(value)).replace(',', '').toUpperCase();
}

function formatResultTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  }).format(new Date(value)).toUpperCase();
}

function scoreClass(
  side: 'home' | 'away',
  match: HomeResultCard,
): string {
  if (!match.scoreAvailable || match.homeScore === match.awayScore) {
    return 'text-primary';
  }

  const won = side === 'home'
    ? match.homeScore > match.awayScore
    : match.awayScore > match.homeScore;
  return won ? 'text-secondary' : 'text-slate-400';
}

function scoreLabel(score: number, available: boolean): string {
  return available ? String(score) : '—';
}

function breakdownLabel(
  breakdown: HomeResultCard['homeBreakdown'],
): string | null {
  if (!breakdown || breakdown.superShots <= 0) return null;
  return `(${breakdown.goals}.${breakdown.superShots})`;
}

export function HomeResultRow({
  match,
  timezone = DEFAULT_TIMEZONE,
}: HomeResultRowProps) {
  const dateLabel = formatResultDate(match.scheduledAt, timezone);
  const timeLabel = formatResultTime(match.scheduledAt, timezone);
  const homeScore = scoreLabel(match.homeScore, match.scoreAvailable);
  const awayScore = scoreLabel(match.awayScore, match.scoreAvailable);
  const homeBreakdown = breakdownLabel(match.homeBreakdown);
  const awayBreakdown = breakdownLabel(match.awayBreakdown);
  const venueLabel = match.venue?.trim();

  return (
    <Link
      href={resultHref(match)}
      prefetch={false}
      aria-label={`${match.homeTeam.name} ${homeScore}, ${match.awayTeam.name} ${awayScore}. ${dateLabel} ${timeLabel}${venueLabel ? ` at ${venueLabel}` : ''}. View match stats`}
      className="group grid min-h-[6.5rem] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_1.5rem] items-center gap-x-2 gap-y-2 px-1 py-3 transition-colors hover:bg-white/65 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-secondary sm:px-3 lg:min-h-[5.25rem] lg:grid-cols-[7.25rem_minmax(0,1fr)_auto_minmax(0,1fr)_minmax(6rem,auto)_1.5rem] lg:gap-x-4 lg:py-2.5"
    >
      <span className="col-span-4 flex min-w-0 items-center gap-2 font-label text-[0.62rem] font-semibold uppercase tracking-[0.04em] text-on-surface-variant lg:col-span-1 lg:block">
        <span className="whitespace-nowrap lg:block">{dateLabel}</span>
        <span className="whitespace-nowrap lg:mt-0.5 lg:block">{timeLabel}</span>
        {venueLabel && (
          <span className="min-w-0 truncate lg:hidden">· {venueLabel}</span>
        )}
      </span>

      <span className="flex min-w-0 flex-col items-center gap-1.5 text-center sm:flex-row-reverse sm:justify-start sm:text-right">
        <TeamBadge
          team={match.homeTeam}
          size={30}
          variant="home"
          className="shrink-0"
        />
        <span className="max-w-full truncate font-headline text-[0.68rem] font-bold uppercase text-primary sm:text-xs">
          {match.homeTeam.name}
        </span>
      </span>

      <span className="flex items-start gap-1.5 font-headline text-[1.55rem] font-black tracking-[-0.05em] sm:text-[1.75rem]">
        <span className="flex flex-col items-center">
          <span className={scoreClass('home', match)}>{homeScore}</span>
          {homeBreakdown && (
            <span className="-mt-1 font-label text-[0.55rem] font-medium tracking-normal text-on-surface-variant">
              {homeBreakdown}
            </span>
          )}
        </span>
        <span className="pt-0.5 text-base text-outline-variant" aria-hidden="true">-</span>
        <span className="flex flex-col items-center">
          <span className={scoreClass('away', match)}>{awayScore}</span>
          {awayBreakdown && (
            <span className="-mt-1 font-label text-[0.55rem] font-medium tracking-normal text-on-surface-variant">
              {awayBreakdown}
            </span>
          )}
        </span>
      </span>

      <span className="flex min-w-0 flex-col items-center gap-1.5 text-center sm:flex-row sm:justify-start sm:text-left">
        <TeamBadge
          team={match.awayTeam}
          size={30}
          variant="away"
          className="shrink-0"
        />
        <span className="max-w-full truncate font-headline text-[0.68rem] font-bold uppercase text-primary sm:text-xs">
          {match.awayTeam.name}
        </span>
      </span>

      <span className="hidden truncate text-right font-label text-[0.62rem] font-medium uppercase text-on-surface-variant lg:block">
        {venueLabel}
      </span>

      <span
        className="material-symbols-outlined text-lg text-secondary transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      >
        chevron_right
      </span>
    </Link>
  );
}
