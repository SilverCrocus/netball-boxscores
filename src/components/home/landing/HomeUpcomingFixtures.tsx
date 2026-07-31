import Link from 'next/link';
import { TeamBadge } from '@/components/ui/TeamBadge';
import type { LandingTeam } from './types';

export interface HomeUpcomingFixture {
  id: string;
  href: string;
  dateLabel: string;
  timeLabel: string;
  venueLabel: string | null;
  homeTeam: LandingTeam;
  awayTeam: LandingTeam;
}

export interface HomeUpcomingFixturesProps {
  title: string;
  fixtures: readonly HomeUpcomingFixture[];
  allFixturesLink: {
    label: string;
    href: string;
  };
  emptyMessage?: string;
  timezoneNote?: string;
}

export function HomeUpcomingFixtures({
  title,
  fixtures,
  allFixturesLink,
  emptyMessage,
  timezoneNote,
}: HomeUpcomingFixturesProps) {
  return (
    <section aria-labelledby="home-upcoming-fixtures-heading">
      <div className="mb-2 flex min-h-11 items-center justify-between gap-4">
        <h2
          id="home-upcoming-fixtures-heading"
          className="font-headline text-lg font-extrabold uppercase tracking-[-0.02em] text-primary sm:text-xl"
        >
          {title}
        </h2>
        <Link
          href={allFixturesLink.href}
          prefetch={false}
          aria-label={allFixturesLink.label}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 px-1 font-label text-[0.65rem] font-bold uppercase tracking-[0.05em] text-secondary hover:text-on-secondary-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
        >
          <span className="hidden sm:inline">{allFixturesLink.label}</span>
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            chevron_right
          </span>
        </Link>
      </div>

      {fixtures.length > 0 ? (
        <ul className="divide-y divide-outline-variant/60 border-y border-outline-variant/60">
          {fixtures.slice(0, 5).map((fixture) => (
            <li key={fixture.id}>
              <Link
                href={fixture.href}
                prefetch={false}
                aria-label={`${fixture.dateLabel} ${fixture.timeLabel}: ${fixture.homeTeam.name} versus ${fixture.awayTeam.name}${fixture.venueLabel ? ` at ${fixture.venueLabel}` : ''}`}
                className="group grid min-h-16 grid-cols-[4.4rem_minmax(0,1fr)_2rem] items-center gap-2 py-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-secondary sm:grid-cols-[6.9rem_minmax(0,1fr)_2rem] md:grid-cols-[6.9rem_minmax(0,1fr)_minmax(5rem,auto)_2rem]"
              >
                <span className="font-label text-[0.65rem] font-medium uppercase leading-relaxed text-on-surface-variant">
                  <span className="block">{fixture.dateLabel}</span>
                  <span className="block">{fixture.timeLabel}</span>
                </span>

                <span className="min-w-0">
                  <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)] items-center gap-1.5 sm:gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <TeamBadge
                        team={fixture.homeTeam}
                        size={28}
                        variant="home"
                        className="shrink-0"
                      />
                      <span className="truncate font-headline text-[0.68rem] font-bold uppercase text-primary sm:text-xs">
                        {fixture.homeTeam.name}
                      </span>
                    </span>
                    <span className="text-center font-label text-[0.65rem] font-semibold uppercase text-on-surface-variant">
                      v
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <TeamBadge
                        team={fixture.awayTeam}
                        size={28}
                        variant="away"
                        className="shrink-0"
                      />
                      <span className="truncate font-headline text-[0.68rem] font-bold uppercase text-primary sm:text-xs">
                        {fixture.awayTeam.name}
                      </span>
                    </span>
                  </span>
                  {fixture.venueLabel && (
                    <span className="mt-1 block truncate font-label text-[0.6rem] font-medium uppercase text-on-surface-variant md:hidden">
                      {fixture.venueLabel}
                    </span>
                  )}
                </span>

                <span className="hidden truncate text-right font-label text-[0.65rem] font-medium uppercase text-on-surface-variant md:block">
                  {fixture.venueLabel}
                </span>

                <span
                  className="material-symbols-outlined text-lg text-secondary transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                >
                  chevron_right
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : emptyMessage ? (
        <div className="border-y border-outline-variant/60 bg-white/70 px-4 py-5 sm:px-5">
          <p className="font-label text-xs leading-relaxed text-on-surface-variant">
            {emptyMessage}
          </p>
        </div>
      ) : (
        <ul
          aria-label={title}
          className="border-y border-outline-variant/60"
        />
      )}

      {timezoneNote && (
        <p className="mt-3 font-label text-[0.65rem] text-on-surface-variant">
          {timezoneNote}
        </p>
      )}
    </section>
  );
}
