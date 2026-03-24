import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import Link from 'next/link';
import Image from 'next/image';
import { TeamBadge } from '@/components/ui/TeamBadge';
import { formatMatchDate, formatMatchTime, formatShortDate } from '@/lib/format';

interface TeamPageProps {
  params: Promise<{ teamSlug: string }>;
}

export default async function TeamPage({ params }: TeamPageProps) {
  const { teamSlug } = await params;

  const team = await prisma.team.findUnique({
    where: { slug: teamSlug },
    include: {
      players: { orderBy: { name: 'asc' } },
      standings: { take: 1 },
      homeMatches: {
        include: { awayTeam: { select: { name: true, abbreviation: true, logoUrl: true } } },
        orderBy: { scheduledAt: 'desc' },
        take: 10,
      },
      awayMatches: {
        include: { homeTeam: { select: { name: true, abbreviation: true, logoUrl: true } } },
        orderBy: { scheduledAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!team) notFound();

  const standing = team.standings[0];
  const allMatches = [
    ...team.homeMatches.map((m) => ({ ...m, opponent: m.awayTeam.name, opponentTeam: m.awayTeam, isHome: true })),
    ...team.awayMatches.map((m) => ({ ...m, opponent: m.homeTeam.name, opponentTeam: m.homeTeam, isHome: false })),
  ].sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  const recentResults = allMatches.filter((m) => m.status === 'COMPLETED').slice(0, 5);
  const upcoming = allMatches.filter((m) => m.status === 'SCHEDULED').reverse().slice(0, 3);

  return (
    <div className="max-w-7xl mx-auto space-y-12">
      {/* Hero */}
      <section className="kinetic-gradient rounded-xl overflow-hidden relative min-h-[400px] flex items-center p-8 md:p-12 text-white shadow-2xl">
        <div className="relative z-10 w-full grid md:grid-cols-2 gap-12 items-center">
          <div className="flex items-center gap-8">
            <div className="w-32 h-32 md:w-48 md:h-48 bg-white/10 backdrop-blur-xl border-4 border-lime-400 rounded-full flex items-center justify-center transform -rotate-12 shadow-inner overflow-hidden">
              {team.logoUrl ? (
                <Image
                  src={team.logoUrl}
                  alt={team.name}
                  width={192}
                  height={192}
                  className="w-full h-full object-contain p-3"
                />
              ) : (
                <span className="font-headline font-black text-7xl md:text-9xl text-lime-400 italic tracking-tighter text-shadow-glow">
                  {team.abbreviation.charAt(0)}
                </span>
              )}
            </div>
            <div>
              {standing && (
                <div className="inline-flex items-center px-3 py-1 rounded-full bg-secondary text-white font-label text-xs font-bold tracking-widest uppercase mb-4">
                  League Ranking #{standing.rank}
                </div>
              )}
              <h1 className="font-headline font-black text-5xl md:text-7xl italic leading-none mb-4 uppercase">
                {team.name.split(' ').map((word, i) => (
                  <span key={i}>
                    {word}
                    {i < team.name.split(' ').length - 1 && <br />}
                  </span>
                ))}
              </h1>
            </div>
          </div>
          {standing && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 backdrop-blur-md p-6 rounded-xl border-l-4 border-lime-400">
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Record</span>
                <span className="font-headline font-bold text-4xl text-white">
                  {standing.wins}-{standing.losses}-{standing.draws}
                </span>
              </div>
              <div className="bg-white/5 backdrop-blur-md p-6 rounded-xl border-l-4 border-lime-400">
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Points</span>
                <span className="font-headline font-bold text-4xl text-lime-400">{standing.points}</span>
              </div>
              <div className="bg-white/5 backdrop-blur-md p-6 rounded-xl border-l-4 border-lime-400">
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Goal %</span>
                <span className="font-headline font-bold text-4xl text-white">{standing.goalPercentage.toFixed(1)}%</span>
              </div>
              <div className="bg-white/5 backdrop-blur-md p-6 rounded-xl border-l-4 border-lime-400">
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Goals For</span>
                <span className="font-headline font-bold text-4xl text-white">{standing.goalsFor}</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Recent Form */}
      {recentResults.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-headline font-bold text-2xl text-primary flex items-center gap-3">
              <span className="w-1 h-8 bg-secondary rounded-full" />
              Recent Form
            </h2>
            <span className="font-label text-on-surface-variant text-sm font-semibold">Last 5 Games</span>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {recentResults.map((m) => {
              const teamScore = m.isHome ? m.homeScore : m.awayScore;
              const oppScore = m.isHome ? m.awayScore : m.homeScore;
              const won = teamScore > oppScore;
              return (
                <Link
                  key={m.id}
                  href={`/match/${m.id}`}
                  className={`flex-shrink-0 flex items-center gap-3 px-6 py-4 bg-surface-container-lowest rounded-xl shadow-sm border-b-2 ${
                    won ? 'border-secondary' : 'border-error'
                  }`}
                >
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${won ? 'bg-secondary' : 'bg-error'}`}>
                    {won ? 'W' : 'L'}
                  </span>
                  <TeamBadge team={m.opponentTeam} size={32} variant="away" />
                  <div>
                    <p className="font-headline font-bold text-sm">vs {m.opponent}</p>
                    <p className="font-label text-xs text-on-surface-variant">
                      {teamScore} - {oppScore}
                      {' \u2022 '}
                      {formatMatchDate(m.scheduledAt)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Roster + Upcoming */}
      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h2 className="font-headline font-bold text-2xl text-primary">Full Roster</h2>
          <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-high border-b border-outline-variant">
                  <th className="p-4 font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant">Player</th>
                  <th className="p-4 font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant">Pos</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {team.players.map((player) => (
                  <tr key={player.id} className="hover:bg-surface-container-low transition-colors cursor-pointer group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded bg-primary-container overflow-hidden flex-shrink-0">
                          {player.photoUrl ? (
                            <Image
                              src={player.photoUrl}
                              alt={player.name}
                              width={40}
                              height={40}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <span className="text-white font-black italic font-headline text-sm">
                                {player.name.charAt(0)}
                              </span>
                            </div>
                          )}
                        </div>
                        <Link href={`/player/${player.id}`} className="font-body font-bold text-primary hover:text-secondary transition-colors">
                          {player.name}
                        </Link>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="bg-primary-container text-primary-fixed-dim px-2 py-1 rounded text-xs font-black font-label">
                        {player.position}
                      </span>
                    </td>
                    <td className="p-4 w-12">
                      <Link href={`/player/${player.id}`} className="text-outline-variant group-hover:text-secondary transition-colors">
                        <span className="material-symbols-outlined text-xl">chevron_right</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="space-y-6">
          <h2 className="font-headline font-bold text-2xl text-primary">Upcoming Fixtures</h2>
          <div className="space-y-4">
            {upcoming.length === 0 && (
              <p className="text-on-surface-variant font-body text-sm">No upcoming fixtures</p>
            )}
            {upcoming.map((m) => (
              <Link
                key={m.id}
                href={`/match/${m.id}`}
                className="block bg-surface-container-lowest p-5 rounded-xl border-l-4 border-secondary shadow-sm"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-3">
                    <TeamBadge team={m.opponentTeam} size={36} variant="away" />
                    <div>
                      <p className="font-label text-xs font-black text-secondary uppercase tracking-widest">
                        {m.isHome ? 'Home' : 'Away'}
                      </p>
                      <p className="font-headline font-bold text-lg mt-1">vs {m.opponent}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-label text-xs font-bold text-on-surface-variant">
                      {formatShortDate(m.scheduledAt)}
                    </p>
                    <p className="font-body font-black text-primary">
                      {formatMatchTime(m.scheduledAt)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
