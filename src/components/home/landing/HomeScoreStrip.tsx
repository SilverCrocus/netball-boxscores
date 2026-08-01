import Link from 'next/link';
import { TeamBadge } from '@/components/ui/TeamBadge';
import type { LandingTeam } from './types';

export interface HomeScoreStripItem {
  id: string;
  href: string;
  meta: string;
  homeTeam: LandingTeam;
  awayTeam: LandingTeam;
  homeScore: number | null;
  awayScore: number | null;
}

export interface HomeScoreStripProps {
  items: readonly HomeScoreStripItem[];
}

function scoreClass(
  side: 'home' | 'away',
  homeScore: number | null,
  awayScore: number | null,
): string {
  if (homeScore == null || awayScore == null || homeScore === awayScore) {
    return 'text-white';
  }

  const won = side === 'home' ? homeScore > awayScore : awayScore > homeScore;
  return won ? 'text-secondary-container' : 'text-slate-400';
}

function scoreLabel(score: number | null): string {
  return score == null ? '—' : String(score);
}

export function HomeScoreStrip({ items }: HomeScoreStripProps) {
  const visibleItems = items.slice(0, 3);
  if (visibleItems.length === 0) return null;

  return (
    <section className="border-t border-white/15 bg-primary text-white" aria-label="Latest scores">
      <div className="mx-auto grid max-w-[1488px] auto-cols-[minmax(19rem,88vw)] grid-flow-col snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:grid-flow-row lg:grid-cols-3 lg:auto-cols-auto lg:overflow-visible">
        {visibleItems.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            prefetch={false}
            aria-label={`${item.homeTeam.name} ${scoreLabel(item.homeScore)}, ${item.awayTeam.name} ${scoreLabel(item.awayScore)}. ${item.meta}`}
            className="group grid h-[98px] snap-start grid-rows-[auto_1fr] border-r border-white/20 px-4 py-2.5 transition-colors last:border-r-0 hover:bg-primary-container focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-secondary-fixed sm:px-6"
          >
            <p className="text-center font-label text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-slate-300">
              {item.meta}
            </p>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
              <div className="flex min-w-0 items-center justify-end gap-2">
                <TeamBadge
                  team={item.homeTeam}
                  size={32}
                  variant="home"
                  className="shrink-0"
                />
                <span className="truncate font-headline text-[0.68rem] font-bold uppercase sm:text-xs">
                  {item.homeTeam.name}
                </span>
              </div>

              <div className="flex items-baseline gap-2 font-headline text-[1.75rem] font-black tracking-[-0.05em]">
                <span className={scoreClass('home', item.homeScore, item.awayScore)}>
                  {scoreLabel(item.homeScore)}
                </span>
                <span className="text-base text-slate-400" aria-hidden="true">-</span>
                <span className={scoreClass('away', item.homeScore, item.awayScore)}>
                  {scoreLabel(item.awayScore)}
                </span>
              </div>

              <div className="flex min-w-0 items-center gap-2">
                <TeamBadge
                  team={item.awayTeam}
                  size={32}
                  variant="away"
                  className="shrink-0"
                />
                <span className="truncate font-headline text-[0.68rem] font-bold uppercase sm:text-xs">
                  {item.awayTeam.name}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
