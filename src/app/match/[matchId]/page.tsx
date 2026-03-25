import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { PlayerStatsTable } from '@/components/ui/PlayerStatsTable';
import { QuarterScoreBar } from '@/components/ui/QuarterScoreBar';
import { MatchMomentum } from '@/components/ui/MatchMomentum';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { JsonLd, sportsEventJsonLd, breadcrumbJsonLd, SITE_URL } from '@/lib/seo';

const getMatch = cache((matchId: string) =>
  prisma.match.findUnique({
    where: { id: matchId },
    include: {
      homeTeam: { select: { name: true, abbreviation: true, logoUrl: true, slug: true } },
      awayTeam: { select: { name: true, abbreviation: true, logoUrl: true, slug: true } },
      quarters: { orderBy: { quarter: 'asc' } },
      playerStats: { include: { player: true }, orderBy: { goals: 'desc' } },
      scoreFlow: { orderBy: [{ period: 'asc' }, { periodSeconds: 'asc' }] },
    },
  })
);

interface MatchPageProps {
  params: Promise<{ matchId: string }>;
}

export async function generateMetadata({ params }: MatchPageProps): Promise<Metadata> {
  const { matchId } = await params;
  const match = await getMatch(matchId);

  if (!match) return { title: 'Match Not Found' };

  const isCompleted = match.status === 'COMPLETED';
  const title = isCompleted
    ? `${match.homeTeam.name} ${match.homeScore} - ${match.awayTeam.name} ${match.awayScore} | Round ${match.round}`
    : `${match.homeTeam.name} vs ${match.awayTeam.name} | Round ${match.round}`;

  const description = isCompleted
    ? `${match.homeTeam.name} ${match.homeScore} - ${match.awayTeam.name} ${match.awayScore}. Round ${match.round} at ${match.venue}.`
    : `${match.homeTeam.name} vs ${match.awayTeam.name}. Round ${match.round} at ${match.venue}.`;

  return { title, description };
}

export default async function MatchPage({ params }: MatchPageProps) {
  const { matchId } = await params;
  const match = await getMatch(matchId);

  if (!match) notFound();

  function toPlayerStatRow(ps: NonNullable<typeof match>['playerStats'][number]) {
    return {
      id: ps.id,
      name: ps.player.name,
      position: ps.player.position,
      photoUrl: ps.player.photoUrl,
      goals: ps.goals,
      attempts: ps.attempts,
      goalAssists: ps.goalAssists,
      intercepts: ps.intercepts,
      deflections: ps.deflections,
      rebounds: ps.rebounds,
      penalties: ps.penalties,
      feeds: ps.feeds,
      centrePassReceives: ps.centrePassReceives,
      turnovers: ps.turnovers,
      minutesPlayed: ps.minutesPlayed,
    };
  }

  const homePlayerStats = match.playerStats
    .filter((ps) => ps.player.teamId === match.homeTeamId)
    .map(toPlayerStatRow);
  const awayPlayerStats = match.playerStats
    .filter((ps) => ps.player.teamId === match.awayTeamId)
    .map(toPlayerStatRow);

  const mvp = match.playerStats.length > 0 ? match.playerStats[0] : null;

  const isLive = match.status === 'LIVE';

  return (
    <div className="max-w-7xl mx-auto">
      <JsonLd data={sportsEventJsonLd({
        homeTeamName: match.homeTeam.name,
        awayTeamName: match.awayTeam.name,
        venue: match.venue,
        scheduledAt: match.scheduledAt,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        round: match.round,
      })} />
      <JsonLd data={breadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: 'Scores', url: '/' },
        { name: `${match.homeTeam.abbreviation} vs ${match.awayTeam.abbreviation}`, url: `/match/${match.id}` },
      ])} />

      {/* Hero Header */}
      <section className="mb-12">
        <div className="flex flex-col md:flex-row justify-between items-end gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              {isLive && <LiveIndicator />}
              <span className="text-on-surface-variant text-xs font-semibold font-label tracking-widest uppercase">
                Round {match.round} {match.venue && `\u2022 ${match.venue}`}
              </span>
            </div>
            <h1 className="text-4xl md:text-6xl font-black font-headline tracking-tighter text-primary-container leading-none uppercase">
              {match.homeTeam.name} vs{' '}
              <span className="text-secondary">{match.awayTeam.name}</span>
            </h1>
          </div>
          <div className="flex items-center gap-4 md:gap-8">
            <div className="text-right">
              <p className="text-xs font-bold font-label text-on-surface-variant uppercase tracking-widest">
                {isLive ? `Q${match.currentQuarter}` : 'Final Score'}
              </p>
              <div className="flex items-center gap-3">
                <span className="text-4xl font-black font-headline text-primary-container">
                  {match.homeScore}
                </span>
                <span className="text-2xl font-bold text-outline-variant">-</span>
                <span className="text-4xl font-black font-headline text-secondary">
                  {match.awayScore}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        {/* Left Column: Tables */}
        <div className="xl:col-span-3 space-y-8">
          <PlayerStatsTable teamName={match.homeTeam.name} players={homePlayerStats} />
          <PlayerStatsTable teamName={match.awayTeam.name} players={awayPlayerStats} />
        </div>

        {/* Right Column: Sidebar */}
        <div className="space-y-6">
          {/* MVP Card */}
          {mvp && (
            <div className="bg-surface-container-highest rounded-xl p-6 border-l-4 border-secondary">
              <div className="flex justify-between items-start mb-6">
                <span className="bg-secondary text-white text-[10px] font-black px-2 py-1 rounded font-label uppercase tracking-tighter">
                  Match MVP
                </span>
                <span
                  className="material-symbols-outlined text-secondary"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  star
                </span>
              </div>
              <div className="flex flex-col items-center text-center">
                <h3 className="font-headline text-xl font-black text-primary-container uppercase">
                  {mvp.player.name}
                </h3>
                <p className="font-label text-xs text-on-surface-variant font-bold uppercase tracking-widest mt-1">
                  {mvp.player.position}
                </p>
                <div className="grid grid-cols-2 w-full gap-4 mt-8">
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <span className="block text-[10px] font-label font-bold text-on-surface-variant uppercase tracking-widest">
                      Goals
                    </span>
                    <span className="text-2xl font-black font-headline text-secondary">
                      {mvp.goals}
                    </span>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <span className="block text-[10px] font-label font-bold text-on-surface-variant uppercase tracking-widest">
                      Reb
                    </span>
                    <span className="text-2xl font-black font-headline text-primary-container">
                      {mvp.rebounds}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Quarter Score Bars */}
          {match.quarters.length > 0 && (
            <div className="bg-surface-container-low rounded-xl p-6">
              <h4 className="text-primary-container font-headline font-bold text-sm uppercase tracking-tight mb-6">
                Quarter Breakdown
              </h4>
              <QuarterScoreBar quarters={match.quarters} />
            </div>
          )}

          {/* Match Momentum */}
          {match.scoreFlow.length > 0 && (
            <MatchMomentum
              scoreFlow={match.scoreFlow}
              homeTeam={match.homeTeam.name}
              awayTeam={match.awayTeam.name}
            />
          )}
        </div>
      </div>
    </div>
  );
}
