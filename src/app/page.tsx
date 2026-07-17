import { prisma, excludeSimData } from '@/lib/db';
import { ScoreCard } from '@/components/ui/ScoreCard';
import { TeamBadge } from '@/components/ui/TeamBadge';
import { formatMatchDateTime } from '@/lib/format';
import { JsonLd, websiteJsonLd, breadcrumbJsonLd } from '@/lib/seo';
import { Countdown } from '@/components/ui/Countdown';
import { formatMatchStage } from '@/lib/match-label';
import { HomeResults } from '@/components/home/HomeResults';
import { MyTeams } from '@/components/home/MyTeams';
import {
  computeBreakdown,
  deriveHomeHeader,
  getCompletedMatchesPage,
  homepageMatchSelect,
  isHomepageScoreAvailable,
  type ResolvedHomepageMatch,
} from '@/lib/home-feed';
import { hasResolvedMatchTeams } from '@/lib/edition-match';
import { resolveCompetition } from '@/lib/competitions';
import { timedQuery } from '@/lib/server-timing';
import Link from 'next/link';
import Image from 'next/image';
import {
  isUpstreamPreviewMode,
  loadUpstreamCompletedMatches,
} from '@/lib/upstream-preview';
import { matchHref } from '@/lib/edition-links';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let liveMatches: ResolvedHomepageMatch[] = [];
  let upcomingMatches: ResolvedHomepageMatch[] = [];
  let completedPage = { groups: [], nextCursor: null } as Awaited<ReturnType<typeof getCompletedMatchesPage>>;
  let season: number | null = null;
  let editionId: string | null = null;
  let databaseUnavailable = false;
  let usingUpstreamPreview = false;

  if (isUpstreamPreviewMode()) {
    const previewPage = await loadUpstreamCompletedMatches();
    if (previewPage) {
      completedPage = previewPage;
      season = new Date().getFullYear();
      editionId = 'upstream-preview';
      usingUpstreamPreview = true;
    } else {
      databaseUnavailable = true;
    }
  } else {
    try {
      const { competition } = await timedQuery('competition_lookup', () => resolveCompetition());

      if (competition) {
        season = competition.season;
        editionId = competition.id;
        const baseWhere = { ...excludeSimData, competitionId: competition.id };
        const [live, upcoming, history] = await Promise.all([
          timedQuery('home_live_matches', () => prisma.match.findMany({
            where: { ...baseWhere, status: 'LIVE' },
            select: homepageMatchSelect,
            orderBy: { scheduledAt: 'asc' },
          })),
          timedQuery('home_upcoming_matches', () => prisma.match.findMany({
            where: { ...baseWhere, status: 'SCHEDULED' },
            select: homepageMatchSelect,
            orderBy: { scheduledAt: 'asc' },
            take: 4,
          })),
          timedQuery('home_completed_history', () => getCompletedMatchesPage(competition.id)),
        ]);
        liveMatches = live.filter(hasResolvedMatchTeams);
        upcomingMatches = upcoming.filter(hasResolvedMatchTeams);
        completedPage = history;
      }
    } catch {
      databaseUnavailable = true;
    }
  }

  const featured = upcomingMatches[0];
  const header = deriveHomeHeader(season, liveMatches, upcomingMatches, completedPage.groups);
  const hasMatches = liveMatches.length > 0 || upcomingMatches.length > 0 || completedPage.groups.length > 0;

  return (
    <div className="max-w-7xl mx-auto">
      <JsonLd data={websiteJsonLd()} />
      <JsonLd data={breadcrumbJsonLd([
        { name: 'Home', url: '/' },
      ])} />
      {/* Hero Header */}
      <section className="mb-12">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <span className="text-secondary font-bold font-label text-sm uppercase tracking-widest">
              {header.eyebrow}
            </span>
            <h1 className="text-4xl md:text-6xl font-black font-headline tracking-tighter text-primary mt-2">
              {header.heading}
            </h1>
            {header.description && (
              <p className="mt-3 max-w-2xl font-body text-on-surface-variant">
                {header.description}
              </p>
            )}
          </div>
        </div>
      </section>

      {databaseUnavailable && (
        <section
          role="alert"
          className="mb-16 rounded-2xl border border-error/30 bg-error/5 px-6 py-10 text-center"
        >
          <span className="material-symbols-outlined mb-3 text-4xl text-error" aria-hidden="true">
            cloud_off
          </span>
          <h2 className="font-headline text-2xl font-bold text-primary">Scores temporarily unavailable</h2>
          <p className="mx-auto mt-2 max-w-lg font-label text-sm text-on-surface-variant">
            CentrePass could not reach the match database. Please try again in a few minutes.
          </p>
        </section>
      )}

      {!databaseUnavailable && !hasMatches && (
        <section className="mb-16 rounded-2xl bg-surface-container-lowest px-6 py-12 text-center shadow-sm">
          <span className="material-symbols-outlined mb-3 text-4xl text-secondary" aria-hidden="true">
            event_upcoming
          </span>
          <h2 className="font-headline text-2xl font-bold text-primary">No fixtures yet</h2>
          <p className="mx-auto mt-2 max-w-lg font-label text-sm text-on-surface-variant">
            The latest season is set up, but its match schedule has not been published.
          </p>
        </section>
      )}

      {usingUpstreamPreview && (
        <p className="mb-8 rounded-xl border border-secondary/20 bg-secondary/5 px-4 py-3 font-label text-xs text-on-surface-variant">
          Local preview: showing current CentrePass results through the hosted read-only API.
        </p>
      )}

      {/* Live Matches */}
      {liveMatches.length > 0 && (
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-3 h-3 rounded-full bg-secondary animate-pulse" />
            <h2 className="text-xl font-bold font-headline text-primary">LIVE ACTION</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {liveMatches.map((match) => (
              <ScoreCard key={match.id} match={{
                ...match,
                scoreAvailable: isHomepageScoreAvailable(match),
                ...computeBreakdown(match),
              }} />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming Fixtures */}
      {upcomingMatches.length > 0 && (
      <section className="mb-20">
        <h2 className="text-xl font-bold font-headline text-primary mb-6">UPCOMING FIXTURES</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          {/* Featured Match */}
          {featured && (
            <Link
              href={matchHref(featured.id, featured.competitionId)}
              prefetch={false}
              className="md:col-span-3 relative overflow-hidden bg-gradient-to-br from-primary via-primary-container to-primary rounded-2xl p-6 md:p-8 text-white flex flex-col justify-center gap-6 shadow-2xl transition-all duration-300 hover:shadow-[0_0_40px_rgba(163,230,53,0.15)] hover:scale-[1.01]"
            >
              {/* Decorative background elements */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-20 -right-20 w-80 h-80 bg-white/5 rounded-full blur-3xl" />
                <div className="absolute -bottom-16 -left-16 w-64 h-64 bg-lime-400/10 rounded-full blur-2xl" />
                <Image
                  src="/netball-cleaned-white.png"
                  alt=""
                  width={500}
                  height={453}
                  className="absolute right-[-10%] top-1/2 h-auto w-[96%] max-w-[700px] -translate-y-1/2 opacity-[0.04]"
                  style={{ height: 'auto' }}
                />
              </div>
              <div className="relative flex min-w-0 flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-lime-400 font-black font-label text-xs uppercase tracking-widest">
                      Next Match &middot; {formatMatchStage(
                        featured.round,
                        featured.finalCode,
                        featured.roundLabel,
                        featured.stage?.name,
                      )}
                    </span>
                    <Countdown scheduledAt={featured.scheduledAt.toISOString()} />
                  </div>
                  <h3 className="text-2xl font-black font-headline leading-tight tracking-tighter italic uppercase break-words [overflow-wrap:anywhere] md:text-4xl">
                    {featured.homeTeam.name} <span className="text-lime-400">vs</span><br />
                    {featured.awayTeam.name}
                  </h3>
                </div>
                <div className="shrink-0 text-left sm:mt-6 sm:pl-4 sm:text-right">
                  <span className="block text-lg font-bold font-headline sm:text-xl sm:whitespace-nowrap">
                    {formatMatchDateTime(featured.scheduledAt)}
                  </span>
                  {featured.venue && (
                    <span className="text-xs uppercase font-label text-slate-300 block mt-1">
                      {featured.venue}
                    </span>
                  )}
                </div>
              </div>
              <div className="relative flex items-center py-4">
                <div className="flex-1 flex flex-col items-center text-center">
                  <div className="w-28 h-28 rounded-full flex items-center justify-center backdrop-blur-md mb-2 overflow-hidden">
                    <TeamBadge team={featured.homeTeam} size={96} variant="home" />
                  </div>
                  <span className="w-full font-bold font-headline text-xs leading-tight uppercase break-words [overflow-wrap:anywhere] sm:text-sm">
                    {featured.homeTeam.name}
                  </span>
                </div>
                <div className="text-lime-400 font-black text-4xl italic px-4">VS</div>
                <div className="flex-1 flex flex-col items-center text-center">
                  <div className="w-28 h-28 rounded-full flex items-center justify-center backdrop-blur-md mb-2 overflow-hidden">
                    <TeamBadge team={featured.awayTeam} size={96} variant="away" />
                  </div>
                  <span className="w-full font-bold font-headline text-xs leading-tight uppercase break-words [overflow-wrap:anywhere] sm:text-sm">
                    {featured.awayTeam.name}
                  </span>
                </div>
              </div>
            </Link>
          )}

          {/* Side Fixtures */}
          <div className="md:col-span-2 flex flex-col gap-4">
            {upcomingMatches.slice(featured ? 1 : 0, 4).map((match) => (
              <Link
                key={match.id}
                href={matchHref(match.id, match.competitionId)}
                prefetch={false}
                className="bg-surface-container rounded-xl p-4 group hover:bg-surface-container-high transition-all flex-1 flex flex-col justify-center"
              >
                <div className="text-base font-bold font-headline text-primary break-words [overflow-wrap:anywhere]">
                  {match.homeTeam.name} v {match.awayTeam.name}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <div className="text-sm font-bold text-on-surface-variant uppercase font-label">
                    {formatMatchDateTime(match.scheduledAt)}
                  </div>
                  <div className="text-xs text-on-surface-variant font-label">
                    {match.venue}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2 px-6">
                  <TeamBadge team={match.homeTeam} size={60} variant="home" />
                  <span className="text-base font-bold text-outline-variant italic">VS</span>
                  <TeamBadge team={match.awayTeam} size={60} variant="away" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
      )}

      <MyTeams />

      {season !== null && editionId !== null && (
        <HomeResults
          initialGroups={completedPage.groups}
          initialNextCursor={completedPage.nextCursor}
          season={season}
          editionId={editionId}
        />
      )}
    </div>
  );
}
