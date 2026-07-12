import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma, excludeSimData } from '@/lib/db';
import Link from 'next/link';
import Image from 'next/image';
import { TeamBadge } from '@/components/ui/TeamBadge';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { formatMatchDate, formatMatchTime, formatShortDate } from '@/lib/format';
import { JsonLd, sportsTeamJsonLd, breadcrumbJsonLd } from '@/lib/seo';

interface TeamPageProps {
  params: Promise<{ teamSlug: string }>;
}

const getTeam = cache((teamSlug: string) =>
  prisma.team.findUnique({
    where: { slug: teamSlug },
    include: {
      players: { orderBy: { name: 'asc' } },
      standings: { take: 1 },
    },
  })
);

export async function generateMetadata({ params }: TeamPageProps): Promise<Metadata> {
  const { teamSlug } = await params;
  const team = await getTeam(teamSlug);

  if (!team) return { title: 'Team Not Found' };

  return {
    title: `${team.name} - Roster & Stats`,
    description: `${team.name} roster, season stats, and recent results in the ${new Date().getFullYear()} Suncorp Super Netball season.`,
  };
}

export default async function TeamPage({ params }: TeamPageProps) {
  const { teamSlug } = await params;

  const team = await getTeam(teamSlug);

  if (!team) notFound();

  const standing = team.standings[0];
  const matchWhere = {
    ...excludeSimData,
    OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }],
  };
  const teamSelect = { name: true, abbreviation: true, logoUrl: true } as const;
  const [recentMatches, upcomingMatches] = await Promise.all([
    prisma.match.findMany({
      where: { ...matchWhere, status: 'COMPLETED' },
      include: { homeTeam: { select: teamSelect }, awayTeam: { select: teamSelect } },
      orderBy: { scheduledAt: 'desc' },
      take: 5,
    }),
    prisma.match.findMany({
      where: {
        ...matchWhere,
        status: 'SCHEDULED',
        scheduledAt: { gte: new Date() },
      },
      include: { homeTeam: { select: teamSelect }, awayTeam: { select: teamSelect } },
      orderBy: { scheduledAt: 'asc' },
      take: 3,
    }),
  ]);
  const withOpponent = (match: (typeof recentMatches)[number]) => {
    const isHome = match.homeTeamId === team.id;
    const opponentTeam = isHome ? match.awayTeam : match.homeTeam;
    return { ...match, isHome, opponent: opponentTeam.name, opponentTeam };
  };
  const recentResults = recentMatches.map(withOpponent);
  const upcoming = upcomingMatches.map(withOpponent);

  return (
    <div className="max-w-7xl mx-auto space-y-12">
      <JsonLd data={sportsTeamJsonLd({
        name: team.name,
        slug: team.slug,
        logoUrl: team.logoUrl,
      })} />
      <JsonLd data={breadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: 'Teams', url: '/teams' },
        { name: team.name, url: `/team/${team.slug}` },
      ])} />
      {/* Hero */}
      <section className="kinetic-gradient relative flex min-h-[400px] items-center overflow-hidden rounded-xl p-4 text-white shadow-2xl sm:p-8 md:p-12">
        <div className="relative z-10 grid w-full min-w-0 items-center gap-8 md:grid-cols-2 md:gap-12">
          <div className="flex min-w-0 flex-col items-start gap-6 sm:flex-row sm:items-center sm:gap-8">
            <div
              className="flex h-28 w-28 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl border-4 bg-white/10 shadow-inner backdrop-blur-xl sm:h-32 sm:w-32 md:h-48 md:w-48"
              style={{ borderColor: team.primaryColor || '#a3e635' }}
            >
              {team.logoUrl ? (
                <Image
                  src={team.logoUrl}
                  alt={team.name}
                  width={192}
                  height={192}
                  className="w-full h-full object-contain p-4"
                />
              ) : (
                <span
                  className="font-headline font-black text-7xl md:text-9xl italic tracking-tighter"
                  style={{ color: team.primaryColor || '#a3e635' }}
                >
                  {team.abbreviation.charAt(0)}
                </span>
              )}
            </div>
            <div className="min-w-0 max-w-full">
              {standing && (
                <div className="inline-flex items-center px-3 py-1 rounded-full bg-secondary text-white font-label text-xs font-bold tracking-widest uppercase mb-4">
                  League Ranking #{standing.rank}
                </div>
              )}
              <h1 className="mb-4 max-w-full font-headline text-4xl font-black italic leading-none uppercase break-words [overflow-wrap:anywhere] sm:text-5xl md:text-7xl">
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
            <div className="grid min-w-0 grid-cols-2 gap-3 sm:gap-4">
              <div className="min-w-0 rounded-xl border-l-4 bg-white/5 p-4 backdrop-blur-md sm:p-6" style={{ borderLeftColor: team.primaryColor || '#a3e635' }}>
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Record</span>
                <span className="font-headline font-bold text-4xl text-white">
                  {standing.wins}-{standing.losses}-{standing.draws}
                </span>
              </div>
              <div className="min-w-0 rounded-xl border-l-4 bg-white/5 p-4 backdrop-blur-md sm:p-6" style={{ borderLeftColor: team.primaryColor || '#a3e635' }}>
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Points</span>
                <span className="font-headline font-bold text-4xl" style={{ color: team.primaryColor || '#a3e635' }}>{standing.points}</span>
              </div>
              <div className="min-w-0 rounded-xl border-l-4 bg-white/5 p-4 backdrop-blur-md sm:p-6" style={{ borderLeftColor: team.primaryColor || '#a3e635' }}>
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Goals For</span>
                <span className="font-headline font-bold text-4xl text-white">{standing.goalsFor}</span>
              </div>
              <div className="min-w-0 rounded-xl border-l-4 bg-white/5 p-4 backdrop-blur-md sm:p-6" style={{ borderLeftColor: team.primaryColor || '#a3e635' }}>
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Goals Against</span>
                <span className="font-headline font-bold text-4xl text-white">{standing.goalsAgainst}</span>
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
              const drawn = teamScore === oppScore;
              const result = drawn ? 'D' : won ? 'W' : 'L';
              const borderColor = drawn ? 'border-outline-variant' : won ? 'border-secondary' : 'border-error';
              const badgeColor = drawn ? 'bg-outline-variant' : won ? 'bg-secondary' : 'bg-error';
              return (
                <Link
                  key={m.id}
                  href={`/match/${m.id}`}
                  className={`flex-shrink-0 flex items-center gap-3 px-6 py-4 bg-surface-container-lowest rounded-xl shadow-sm border-b-2 ${
                    borderColor
                  }`}
                >
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${badgeColor}`}>
                    {result}
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
                        <PlayerAvatar name={player.name} photoUrl={player.photoUrl} size={40} className="rounded" />
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
