import { prisma, excludeSimData } from '@/lib/db';
import { ScoreCard } from '@/components/ui/ScoreCard';
import { TeamBadge } from '@/components/ui/TeamBadge';
import { formatMatchDateTime } from '@/lib/format';
import { JsonLd, websiteJsonLd, breadcrumbJsonLd } from '@/lib/seo';
import { Countdown } from '@/components/ui/Countdown';
import { formatMatchStage } from '@/lib/match-label';
import Link from 'next/link';
import Image from 'next/image';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

const homepageMatchSelect = {
  id: true,
  status: true,
  scheduledAt: true,
  homeScore: true,
  awayScore: true,
  venue: true,
  round: true,
  finalCode: true,
  currentQuarter: true,
  currentTime: true,
  homeTeamId: true,
  awayTeamId: true,
  homeTeam: { select: { name: true, abbreviation: true, logoUrl: true } },
  awayTeam: { select: { name: true, abbreviation: true, logoUrl: true } },
  teamStats: { select: { teamId: true, goals: true, goal2: true } },
} satisfies Prisma.MatchSelect;

type HomepageMatch = Prisma.MatchGetPayload<{ select: typeof homepageMatchSelect }>;

export default async function HomePage() {
  let matches: HomepageMatch[] = [];
  let databaseUnavailable = false;

  try {
    const competition = await prisma.competition.findFirst({
      orderBy: { season: 'desc' },
      select: { id: true },
    });

    if (competition) {
      const baseWhere = { ...excludeSimData, competitionId: competition.id };
      const [live, upcoming, completed] = await Promise.all([
        prisma.match.findMany({
          where: { ...baseWhere, status: 'LIVE' },
          select: homepageMatchSelect,
          orderBy: { scheduledAt: 'asc' },
        }),
        prisma.match.findMany({
          where: { ...baseWhere, status: 'SCHEDULED' },
          select: homepageMatchSelect,
          orderBy: { scheduledAt: 'asc' },
          take: 4,
        }),
        prisma.match.findMany({
          where: { ...baseWhere, status: 'COMPLETED' },
          select: homepageMatchSelect,
          orderBy: { scheduledAt: 'desc' },
        }),
      ]);
      matches = [...live, ...upcoming, ...completed];
    }
  } catch {
    databaseUnavailable = true;
  }

  function computeBreakdown(match: HomepageMatch) {
    const home = match.teamStats.find((stat) => stat.teamId === match.homeTeamId);
    const away = match.teamStats.find((stat) => stat.teamId === match.awayTeamId);
    const hasSuperShots = (home?.goal2 ?? 0) > 0 || (away?.goal2 ?? 0) > 0;

    return {
      homeBreakdown: hasSuperShots && home
        ? { goals: Math.max(0, home.goals - home.goal2), superShots: home.goal2 } : null,
      awayBreakdown: hasSuperShots && away
        ? { goals: Math.max(0, away.goals - away.goal2), superShots: away.goal2 } : null,
    };
  }

  const liveMatches = matches.filter((m) => m.status === 'LIVE');
  const upcomingMatches = matches.filter((m) => m.status === 'SCHEDULED');
  const sortedCompleted = matches
    .filter((m) => m.status === 'COMPLETED')
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  // Group regular rounds and finals stages, newest first.
  const resultsByStage = new Map<string, typeof sortedCompleted>();
  for (const match of sortedCompleted) {
    const label = formatMatchStage(match.round, match.finalCode);
    const group = resultsByStage.get(label) ?? [];
    group.push(match);
    resultsByStage.set(label, group);
  }
  for (const group of resultsByStage.values()) {
    group.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }
  const featured = upcomingMatches[0];

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
              Game Day Hub
            </span>
            <h1 className="text-4xl md:text-6xl font-black font-headline tracking-tighter text-primary mt-2">
              TODAY&apos;S PULSE
            </h1>
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

      {!databaseUnavailable && matches.length === 0 && (
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

      {/* Live Matches */}
      {liveMatches.length > 0 && (
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-3 h-3 rounded-full bg-secondary animate-pulse" />
            <h2 className="text-xl font-bold font-headline text-primary">LIVE ACTION</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {liveMatches.map((match) => (
              <ScoreCard key={match.id} match={{ ...match, ...computeBreakdown(match) }} />
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
              href={`/match/${featured.id}`}
              className="md:col-span-3 relative overflow-hidden bg-gradient-to-br from-primary via-primary-container to-primary rounded-2xl p-6 md:p-8 text-white flex flex-col justify-center gap-6 shadow-2xl transition-all duration-300 hover:shadow-[0_0_40px_rgba(163,230,53,0.15)] hover:scale-[1.01]"
            >
              {/* Decorative background elements */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-20 -right-20 w-80 h-80 bg-white/5 rounded-full blur-3xl" />
                <div className="absolute -bottom-16 -left-16 w-64 h-64 bg-lime-400/10 rounded-full blur-2xl" />
                <Image
                  src="/netball-cleaned-white.png"
                  alt=""
                  width={700}
                  height={634}
                  className="absolute right-[-10%] top-1/2 h-auto w-[96%] max-w-[700px] -translate-y-1/2 opacity-[0.04]"
                  style={{ height: 'auto' }}
                />
              </div>
              <div className="relative flex min-w-0 flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-lime-400 font-black font-label text-xs uppercase tracking-widest">
                      Next Match &middot; {formatMatchStage(featured.round, featured.finalCode)}
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
                href={`/match/${match.id}`}
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

      {/* Results grouped by regular round or finals stage */}
      {resultsByStage.size > 0 && (
        <section className="mb-16">
          <h2 className="text-xl font-bold font-headline text-primary mb-6">RESULTS</h2>
          {Array.from(resultsByStage.entries()).map(([stage, stageMatches]) => (
            <div key={stage} className="mb-8">
              <h3 className="text-sm font-semibold text-on-surface-variant mb-3 pb-2 border-b border-outline-variant">
                {stage}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {stageMatches.map((match) => (
                  <ScoreCard
                    key={match.id}
                    match={{ ...match, round: undefined, ...computeBreakdown(match) }}
                    showFinalBadge={false}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
