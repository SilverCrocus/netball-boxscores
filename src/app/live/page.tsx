import { redirect } from 'next/navigation';
import { getLiveState } from '@/lib/live-state';
import { prisma, excludeSimData } from '@/lib/db';
import { resolveCompetition } from '@/lib/competitions';
import { computeBreakdown, homepageMatchSelect } from '@/lib/home-feed';
import { ScoreCard } from '@/components/ui/ScoreCard';
import Link from 'next/link';
import { hasResolvedMatchTeams } from '@/lib/edition-match';
import { matchHref } from '@/lib/edition-links';

export const dynamic = 'force-dynamic';

export default async function LivePage() {
  const state = await getLiveState();

  if (state.liveMatchIds.length === 1) {
    const liveMatch = state.liveMatches[0];
    redirect(matchHref(liveMatch.id, liveMatch.competitionId, 'live'));
  }

  const { competition } = await resolveCompetition();
  const baseWhere = competition
    ? { ...excludeSimData, competitionId: competition.id }
    : { ...excludeSimData };

  if (state.liveMatchIds.length > 1) {
    const matches = await prisma.match.findMany({
      where: { id: { in: state.liveMatchIds } },
      select: homepageMatchSelect,
      orderBy: { scheduledAt: 'asc' },
    });
    const liveMatches = matches.filter(hasResolvedMatchTeams);

    return (
      <div className="mx-auto max-w-7xl">
        <p className="font-label text-sm font-bold uppercase tracking-widest text-secondary">Live Hub</p>
        <h1 className="mt-2 font-headline text-4xl font-black uppercase tracking-tighter text-primary md:text-6xl">
          Choose a live match
        </h1>
        <p className="mt-3 max-w-2xl text-on-surface-variant">
          More than one match is in progress. Pick the game you want to follow.
        </p>
        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
          {liveMatches.map((match) => (
            <ScoreCard key={match.id} match={{ ...match, ...computeBreakdown(match) }} />
          ))}
        </div>
      </div>
    );
  }

  const now = new Date();
  const [nextMatch, latestResult] = await Promise.all([
    prisma.match.findFirst({
      where: { ...baseWhere, status: 'SCHEDULED', scheduledAt: { gte: now } },
      select: homepageMatchSelect,
      orderBy: { scheduledAt: 'asc' },
    }),
    prisma.match.findFirst({
      where: { ...baseWhere, status: 'COMPLETED' },
      select: homepageMatchSelect,
      orderBy: { scheduledAt: 'desc' },
    }),
  ]);

  return (
    <div className="mx-auto max-w-7xl">
      <section className="kinetic-gradient overflow-hidden rounded-2xl px-6 py-12 text-white shadow-2xl md:px-12 md:py-16">
        <p className="font-label text-sm font-bold uppercase tracking-widest text-secondary-fixed">Live Hub</p>
        <h1 className="mt-3 max-w-3xl font-headline text-4xl font-black uppercase tracking-tighter md:text-6xl">
          No match is live right now
        </h1>
        <p className="mt-4 max-w-2xl font-body text-sm leading-relaxed text-slate-300 md:text-base">
          Check the next fixture below or catch up on the latest result while we wait for the next centre pass.
        </p>
        <Link
          href="/"
          className="mt-7 inline-flex min-h-11 items-center rounded-xl bg-secondary-fixed px-5 font-headline text-sm font-bold uppercase tracking-wider text-on-secondary-fixed"
        >
          View all fixtures
        </Link>
      </section>

      <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section aria-labelledby="next-live-heading">
          <h2 id="next-live-heading" className="mb-4 font-headline text-2xl font-bold text-primary">Next fixture</h2>
          {nextMatch && hasResolvedMatchTeams(nextMatch) ? (
            <ScoreCard match={nextMatch} />
          ) : (
            <p className="rounded-xl bg-surface-container-lowest p-6 text-on-surface-variant shadow-sm">
              The next fixture has not been published yet.
            </p>
          )}
        </section>
        <section aria-labelledby="latest-live-heading">
          <h2 id="latest-live-heading" className="mb-4 font-headline text-2xl font-bold text-primary">Latest result</h2>
          {latestResult && hasResolvedMatchTeams(latestResult) ? (
            <ScoreCard match={{ ...latestResult, ...computeBreakdown(latestResult) }} />
          ) : (
            <p className="rounded-xl bg-surface-container-lowest p-6 text-on-surface-variant shadow-sm">
              No completed result is available yet.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
