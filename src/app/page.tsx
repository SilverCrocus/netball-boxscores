import { prisma, excludeSimData } from '@/lib/db';
import { ScoreCard } from '@/components/ui/ScoreCard';
import { TeamBadge } from '@/components/ui/TeamBadge';
import { formatMatchDateTime } from '@/lib/format';
import { JsonLd, websiteJsonLd, breadcrumbJsonLd } from '@/lib/seo';
import { Countdown } from '@/components/ui/Countdown';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let matches: Array<{
    id: string;
    status: 'LIVE' | 'COMPLETED' | 'SCHEDULED';
    scheduledAt: Date;
    homeScore: number;
    awayScore: number;
    venue: string;
    round: number;
    currentQuarter: number | null;
    homeTeam: { name: string; abbreviation: string; logoUrl: string | null };
    awayTeam: { name: string; abbreviation: string; logoUrl: string | null };
  }> = [];

  try {
    matches = await prisma.match.findMany({
      where: excludeSimData,
      include: {
        homeTeam: { select: { name: true, abbreviation: true, logoUrl: true } },
        awayTeam: { select: { name: true, abbreviation: true, logoUrl: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  } catch {
    // DB unavailable (e.g. Supabase free tier paused) — show empty state
  }

  const liveMatches = matches.filter((m) => m.status === 'LIVE');
  const upcomingMatches = matches.filter((m) => m.status === 'SCHEDULED');
  // Sort completed matches by round desc, then scheduledAt asc within each round
  const sortedCompleted = matches
    .filter((m) => m.status === 'COMPLETED')
    .sort((a, b) => {
      if (a.round !== b.round) return b.round - a.round;
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });

  // Group by round
  const resultsByRound = new Map<number, typeof sortedCompleted>();
  for (const match of sortedCompleted) {
    const group = resultsByRound.get(match.round) ?? [];
    group.push(match);
    resultsByRound.set(match.round, group);
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

      {/* Live Matches */}
      {liveMatches.length > 0 && (
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-3 h-3 rounded-full bg-secondary animate-pulse" />
            <h2 className="text-xl font-bold font-headline text-primary">LIVE ACTION</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {liveMatches.map((match) => (
              <ScoreCard key={match.id} match={match} />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming Fixtures */}
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
                <img
                  src="/netball-cleaned-white.png"
                  alt=""
                  className="absolute right-[-10%] top-1/2 -translate-y-1/2 w-[96%] max-w-[700px] opacity-[0.04]"
                />
              </div>
              <div className="relative flex justify-between items-start">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="text-lime-400 font-black font-label text-xs uppercase tracking-widest">
                      Next Match &middot; Round {featured.round}
                    </span>
                    <Countdown scheduledAt={featured.scheduledAt.toISOString()} />
                  </div>
                  <h3 className="text-2xl md:text-4xl font-black font-headline tracking-tighter italic uppercase leading-tight">
                    {featured.homeTeam.name} <span className="text-lime-400">vs</span><br />
                    {featured.awayTeam.name}
                  </h3>
                </div>
                <div className="text-right shrink-0 pl-4 mt-6">
                  <span className="block text-xl font-bold font-headline whitespace-nowrap">
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
                  <span className="font-bold font-headline uppercase text-sm">
                    {featured.homeTeam.name}
                  </span>
                </div>
                <div className="text-lime-400 font-black text-4xl italic px-4">VS</div>
                <div className="flex-1 flex flex-col items-center text-center">
                  <div className="w-28 h-28 rounded-full flex items-center justify-center backdrop-blur-md mb-2 overflow-hidden">
                    <TeamBadge team={featured.awayTeam} size={96} variant="away" />
                  </div>
                  <span className="font-bold font-headline uppercase text-sm">
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
                <div className="text-base font-bold font-headline text-primary">
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

      {/* Results grouped by round */}
      {resultsByRound.size > 0 && (
        <section className="mb-16">
          <h2 className="text-xl font-bold font-headline text-primary mb-6">RESULTS</h2>
          {Array.from(resultsByRound.entries()).map(([round, roundMatches]) => (
            <div key={round} className="mb-8">
              <h3 className="text-sm font-semibold text-on-surface-variant mb-3 pb-2 border-b border-outline-variant">
                Round {round}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {roundMatches.map((match) => (
                  <ScoreCard
                    key={match.id}
                    match={{ ...match, round: undefined }}
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
