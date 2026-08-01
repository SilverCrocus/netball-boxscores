import { HomeResultRow } from '@/components/home/landing/HomeResultRow';
import type { HomeResultGroup } from '@/lib/home-feed';

interface HomeRecentResultsProps {
  groups: readonly HomeResultGroup[];
  timezone?: string;
}

const MAX_RECENT_RESULTS = 5;

export function HomeRecentResults({
  groups,
  timezone,
}: HomeRecentResultsProps) {
  const matches = groups
    .flatMap((group) => group.matches)
    .toSorted((left, right) =>
      new Date(right.scheduledAt).getTime() - new Date(left.scheduledAt).getTime()
      || left.id.localeCompare(right.id))
    .slice(0, MAX_RECENT_RESULTS);

  if (matches.length === 0) return null;

  return (
    <section aria-labelledby="home-recent-results-heading">
      <div className="mb-2 flex min-h-11 items-center justify-between gap-4">
        <h2
          id="home-recent-results-heading"
          className="font-headline text-lg font-extrabold uppercase tracking-[-0.02em] text-primary sm:text-xl"
        >
          Recent results
        </h2>
        <span className="font-label text-[0.65rem] font-bold uppercase tracking-[0.05em] text-secondary">
          Latest final scores
        </span>
      </div>

      <ul
        aria-label="Recent results"
        className="divide-y divide-outline-variant/60 border-y border-outline-variant/60"
      >
        {matches.map((match) => (
          <li key={match.id}>
            <HomeResultRow match={match} timezone={timezone} />
          </li>
        ))}
      </ul>
    </section>
  );
}
