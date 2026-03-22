import { prisma } from '@/lib/db';
import { ScoreCard } from '@/components/ui/ScoreCard';
import Link from 'next/link';

export default async function HomePage() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const matches = await prisma.match.findMany({
    where: {
      scheduledAt: { gte: today, lt: tomorrow },
    },
    include: {
      homeTeam: { select: { name: true, abbreviation: true, logoUrl: true } },
      awayTeam: { select: { name: true, abbreviation: true, logoUrl: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  const liveMatches = matches.filter((m) => m.status === 'LIVE');
  const upcomingMatches = matches.filter((m) => m.status === 'SCHEDULED');
  const completedMatches = matches.filter((m) => m.status === 'COMPLETED');
  const featured = upcomingMatches[0];

  return (
    <div className="max-w-7xl mx-auto">
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Featured Match */}
          {featured && (
            <Link
              href={`/match/${featured.id}`}
              className="md:col-span-2 bg-gradient-to-br from-primary to-primary-container rounded-2xl p-8 text-white flex flex-col justify-between min-h-[300px] shadow-2xl"
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <span className="text-lime-400 font-black font-label text-xs uppercase tracking-widest">
                    Match of the Day
                  </span>
                  <h3 className="text-3xl font-black font-headline tracking-tighter italic uppercase">
                    {featured.homeTeam.name} vs {featured.awayTeam.name}
                  </h3>
                </div>
                <div className="text-right">
                  <span className="block text-2xl font-bold font-headline">
                    {new Date(featured.scheduledAt).toLocaleTimeString('en-AU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {featured.venue && (
                    <span className="text-[10px] uppercase font-label text-slate-400">
                      {featured.venue}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-around py-8">
                <div className="text-center">
                  <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-md mb-3">
                    <span className="text-3xl font-black italic font-headline">
                      {featured.homeTeam.abbreviation.charAt(0)}
                    </span>
                  </div>
                  <span className="font-bold font-headline uppercase">
                    {featured.homeTeam.name}
                  </span>
                </div>
                <div className="text-lime-400 font-black text-4xl italic px-4">VS</div>
                <div className="text-center">
                  <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-md mb-3">
                    <span className="text-3xl font-black italic font-headline">
                      {featured.awayTeam.abbreviation.charAt(0)}
                    </span>
                  </div>
                  <span className="font-bold font-headline uppercase">
                    {featured.awayTeam.name}
                  </span>
                </div>
              </div>
            </Link>
          )}

          {/* Side Fixtures */}
          <div className="flex flex-col gap-4">
            {upcomingMatches.slice(featured ? 1 : 0, 4).map((match) => (
              <Link
                key={match.id}
                href={`/match/${match.id}`}
                className="bg-surface-container rounded-xl p-4 flex items-center justify-between group hover:bg-surface-container-high transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm">
                    <span className="font-black italic text-primary font-headline">
                      {match.homeTeam.abbreviation.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-on-surface-variant uppercase font-label">
                      {new Date(match.scheduledAt).toLocaleTimeString('en-AU', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    <div className="text-sm font-bold font-headline text-primary">
                      {match.homeTeam.abbreviation} v {match.awayTeam.abbreviation}
                    </div>
                  </div>
                </div>
                <span className="material-symbols-outlined text-outline-variant group-hover:text-primary transition-colors">
                  calendar_today
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Completed */}
      {completedMatches.length > 0 && (
        <section className="mb-16">
          <h2 className="text-xl font-bold font-headline text-primary mb-6">RESULTS</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {completedMatches.map((match) => (
              <ScoreCard key={match.id} match={match} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
