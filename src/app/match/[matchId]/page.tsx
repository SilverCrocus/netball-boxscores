import { cache } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { PlayerStatsTable } from '@/components/ui/PlayerStatsTable';
import { QuarterScoreBar } from '@/components/ui/QuarterScoreBar';
import { TeamBadge } from '@/components/ui/TeamBadge';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { MatchMomentumChart } from '@/components/ui/MatchMomentumChart';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { MatchStatsComparison } from '@/components/match/MatchStatsComparison';
import { MatchTimeline } from '@/components/match/MatchTimeline';
import { MatchActions } from '@/components/match/MatchActions';
import { MatchCoverageNotice } from '@/components/match/MatchCoverageNotice';
import { MatchTabs } from './MatchTabs';
import { JsonLd, sportsEventJsonLd, breadcrumbJsonLd } from '@/lib/seo';
import { pickStatFields, computeShootingPct } from '@/lib/stat-utils';
import { formatMatchDateTime } from '@/lib/format';
import { formatMatchStage } from '@/lib/match-label';
import { timedQuery } from '@/lib/server-timing';
import { getMvpSupportingStats } from '@/lib/mvp-stats';
import { hasResolvedMatchTeams } from '@/lib/edition-match';
import { secondaryPlayerPhotoUrl } from '@/lib/player-photo';
import { editionScopedHref, isCanonicalMatchEdition, matchHref } from '@/lib/edition-links';
import { isFinalFixture, resolveEditionFeatures } from '@/lib/edition-capabilities';
import { playerTeamIdForMatch } from '@/lib/match-player-team';

const getMatch = cache((matchId: string) =>
  timedQuery('match_base', () => prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      competitionId: true,
      resultQuality: true,
      status: true,
      homeScore: true,
      awayScore: true,
      currentQuarter: true,
      currentTime: true,
      round: true,
      roundLabel: true,
      finalCode: true,
      stage: { select: { name: true } },
      venue: true,
      scheduledAt: true,
      homeTeamId: true,
      awayTeamId: true,
      homeTeam: { select: { name: true, abbreviation: true, logoUrl: true, slug: true, primaryColor: true } },
      awayTeam: { select: { name: true, abbreviation: true, logoUrl: true, slug: true, primaryColor: true } },
      competition: {
        select: {
          dataCoverage: {
            where: { matchId: null },
            select: { capability: true, state: true },
          },
        },
      },
      dataCoverage: {
        select: { capability: true, state: true },
      },
      quarters: {
        select: { quarter: true, homeScore: true, awayScore: true },
        orderBy: { quarter: 'asc' },
      },
      playerStats: {
        select: {
          id: true,
          goals: true,
          attempts: true,
          goalAssists: true,
          intercepts: true,
          deflections: true,
          rebounds: true,
          penalties: true,
          feeds: true,
          centrePassReceives: true,
          turnovers: true,
          minutesPlayed: true,
          netPoints: true,
          gain: true,
          player: {
            select: {
              id: true,
              name: true,
              position: true,
              photoUrl: true,
              photoSourceUrl: true,
              photoCredit: true,
              photoLicense: true,
              rosterMemberships: {
                where: { status: 'ACTIVE' },
                select: {
                  editionEntry: {
                    select: { competitionId: true, teamId: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { goals: 'desc' },
      },
      scoreFlow: {
        select: {
          id: true,
          period: true,
          periodSeconds: true,
          scoringTeamId: true,
          homeScore: true,
          awayScore: true,
          scorePoints: true,
          scorerPlayerId: true,
        },
        orderBy: [{ period: 'asc' }, { periodSeconds: 'asc' }],
      },
      _count: { select: { matchEvents: true } },
    },
  }))
);

interface MatchPageProps {
  params: Promise<{ matchId: string }>;
  searchParams?: Promise<{ edition?: string }>;
}

export async function generateMetadata({ params }: MatchPageProps): Promise<Metadata> {
  const { matchId } = await params;
  const match = await getMatch(matchId);

  if (!match || !hasResolvedMatchTeams(match)) return { title: 'Match Not Found' };

  const features = resolveEditionFeatures(match.competition.dataCoverage, match.dataCoverage);
  const isCompleted = isFinalFixture(match.status, match.resultQuality)
    && features.finalScore.available;
  const stage = formatMatchStage(match.round, match.finalCode, match.roundLabel, match.stage?.name);
  const title = isCompleted
    ? `${match.homeTeam.name} ${match.homeScore} - ${match.awayTeam.name} ${match.awayScore} | ${stage}`
    : `${match.homeTeam.name} vs ${match.awayTeam.name} | ${stage}`;

  const description = isCompleted
    ? `${match.homeTeam.name} ${match.homeScore} - ${match.awayTeam.name} ${match.awayScore}. ${stage} at ${match.venue}.`
    : `${match.homeTeam.name} vs ${match.awayTeam.name}. ${stage} at ${match.venue}.`;

  return { title, description };
}

export default async function MatchPage({ params, searchParams }: MatchPageProps) {
  const [{ matchId }, query] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<{ edition?: string }>({}),
  ]);
  const match = await getMatch(matchId);

  if (!match || !hasResolvedMatchTeams(match)) notFound();

  if (!isCanonicalMatchEdition(query.edition, match.competitionId)) {
    redirect(matchHref(match.id, match.competitionId));
  }

  const features = resolveEditionFeatures(match.competition.dataCoverage, match.dataCoverage);

  const superShotsByPlayer = new Map<string, number>();
  let homeSuperShots = 0, awaySuperShots = 0;
  let homeNormalGoals = 0, awayNormalGoals = 0;
  for (const sf of match.scoreFlow) {
    if (sf.scorePoints === 2) {
      if (sf.scoringTeamId === match.homeTeamId) homeSuperShots++;
      else awaySuperShots++;
      if (sf.scorerPlayerId) {
        superShotsByPlayer.set(sf.scorerPlayerId, (superShotsByPlayer.get(sf.scorerPlayerId) || 0) + 1);
      }
    } else {
      if (sf.scoringTeamId === match.homeTeamId) homeNormalGoals++;
      else awayNormalGoals++;
    }
  }
  const hasSuperShots = features.superShots.available
    && (homeSuperShots > 0 || awaySuperShots > 0);

  function toPlayerStatRow(ps: NonNullable<typeof match>['playerStats'][number]) {
    return {
      id: ps.id,
      playerId: ps.player.id,
      name: ps.player.name,
      position: ps.player.position,
      photoUrl: secondaryPlayerPhotoUrl(ps.player),
      superShots: superShotsByPlayer.get(ps.player.id) || 0,
      ...pickStatFields(ps),
    };
  }

  const matchTeamIds = [match.homeTeamId, match.awayTeamId];
  const homePlayerStats = match.playerStats
    .filter((ps) => playerTeamIdForMatch(ps.player, match.competitionId, matchTeamIds) === match.homeTeamId)
    .map(toPlayerStatRow);
  const awayPlayerStats = match.playerStats
    .filter((ps) => playerTeamIdForMatch(ps.player, match.competitionId, matchTeamIds) === match.awayTeamId)
    .map(toPlayerStatRow);

  const mvp = features.netPoints.available
    ? match.playerStats.reduce<(typeof match.playerStats)[number] | null>(
        (best, candidate) => !best || candidate.netPoints > best.netPoints ? candidate : best,
        null,
      )
    : null;
  const mvpSupportingStats = mvp
    ? getMvpSupportingStats({ ...mvp, position: mvp.player.position })
    : [];

  const sumStat = (players: typeof homePlayerStats, key: keyof (typeof homePlayerStats)[number]) =>
    players.reduce((sum, p) => sum + (Number(p[key]) || 0), 0);

  const homeGoals = sumStat(homePlayerStats, 'goals');
  const awayGoals = sumStat(awayPlayerStats, 'goals');
  const homeAttempts = sumStat(homePlayerStats, 'attempts');
  const awayAttempts = sumStat(awayPlayerStats, 'attempts');

  const comparisonStats = [
    { label: 'Goals', homeValue: homeGoals, awayValue: awayGoals },
    { label: 'Goal %', homeValue: Math.round(computeShootingPct(homeGoals, homeAttempts)), awayValue: Math.round(computeShootingPct(awayGoals, awayAttempts)), format: 'percentage' as const },
    { label: 'Intercepts', homeValue: sumStat(homePlayerStats, 'intercepts'), awayValue: sumStat(awayPlayerStats, 'intercepts') },
    { label: 'Deflections', homeValue: sumStat(homePlayerStats, 'deflections'), awayValue: sumStat(awayPlayerStats, 'deflections') },
    { label: 'Rebounds', homeValue: sumStat(homePlayerStats, 'rebounds'), awayValue: sumStat(awayPlayerStats, 'rebounds') },
    { label: 'Turnovers', homeValue: sumStat(homePlayerStats, 'turnovers'), awayValue: sumStat(awayPlayerStats, 'turnovers') },
    { label: 'Feeds', homeValue: sumStat(homePlayerStats, 'feeds'), awayValue: sumStat(awayPlayerStats, 'feeds') },
    { label: 'Goal Assists', homeValue: sumStat(homePlayerStats, 'goalAssists'), awayValue: sumStat(awayPlayerStats, 'goalAssists') },
    { label: 'Centre Pass Receives', homeValue: sumStat(homePlayerStats, 'centrePassReceives'), awayValue: sumStat(awayPlayerStats, 'centrePassReceives') },
    { label: 'Penalties', homeValue: sumStat(homePlayerStats, 'penalties'), awayValue: sumStat(awayPlayerStats, 'penalties') },
  ];

  const isLive = match.status === 'LIVE';
  const isFinal = isFinalFixture(match.status, match.resultQuality);
  const showScore = features.finalScore.available && (isLive || isFinal);
  const showPlayerBoxScore = features.playerBoxScore.available
    && (homePlayerStats.length > 0 || awayPlayerStats.length > 0);
  const showScoreFlow = features.scoreFlow.available && match.scoreFlow.length > 0;
  const showMatchEvents = features.matchEvents.available && match._count.matchEvents > 0;
  const showPeriodScores = features.periodScores.available && match.quarters.length > 0;
  const hasBoxScoreContent = showPlayerBoxScore || showScoreFlow || showPeriodScores || mvp !== null;
  const stage = formatMatchStage(match.round, match.finalCode, match.roundLabel, match.stage?.name);
  const lifecycleLabel = isLive
    ? (match.currentQuarter ? `Q${match.currentQuarter}` : 'Live')
    : isFinal
      ? 'Final'
      : match.status.toLocaleLowerCase().replaceAll('_', ' ');

  return (
    <div className="max-w-7xl mx-auto">
      <JsonLd data={sportsEventJsonLd({
        homeTeamName: match.homeTeam.name,
        awayTeamName: match.awayTeam.name,
        venue: match.venue,
        scheduledAt: match.scheduledAt,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        matchLabel: stage,
      })} />
      <JsonLd data={breadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: 'Scores', url: '/' },
        { name: `${match.homeTeam.abbreviation} vs ${match.awayTeam.abbreviation}`, url: matchHref(match.id, match.competitionId) },
      ])} />

      {/* Hero Header */}
      <section className="mb-12">
        <div className="flex items-center gap-2 mb-4">
          {isLive && <LiveIndicator />}
          <span className="text-on-surface-variant text-xs font-semibold font-label tracking-widest uppercase">
            {stage} {match.venue && `\u2022 ${match.venue}`} &bull; {formatMatchDateTime(match.scheduledAt)}
          </span>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-6 md:gap-10">
          {/* Home Team */}
          <div className="flex items-center gap-4 flex-1 justify-end">
            <div className="text-right">
              <h1 className="text-2xl md:text-4xl font-black font-headline tracking-tighter text-primary-container leading-none uppercase">
                {match.homeTeam.name}
              </h1>
            </div>
            <TeamBadge team={match.homeTeam} size={80} variant="home" />
          </div>

          {/* Score */}
          <div className="flex flex-col items-center">
            <p className="text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest mb-1">
              {lifecycleLabel}
            </p>
            {showScore ? (
              <div className="flex items-center gap-3 md:gap-5">
                <div className="flex flex-col items-center">
                  <span className="text-5xl md:text-7xl font-black font-headline text-primary-container">
                    {match.homeScore}
                  </span>
                  {hasSuperShots && (
                    <span className="font-label text-[11px] text-on-surface-variant/60 font-medium mt-[-2px]">
                      ({homeNormalGoals}.{homeSuperShots})
                    </span>
                  )}
                </div>
                <span className="text-3xl font-bold text-outline-variant">-</span>
                <div className="flex flex-col items-center">
                  <span className="text-5xl md:text-7xl font-black font-headline text-secondary">
                    {match.awayScore}
                  </span>
                  {hasSuperShots && (
                    <span className="font-label text-[11px] text-on-surface-variant/60 font-medium mt-[-2px]">
                      ({awayNormalGoals}.{awaySuperShots})
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex min-h-20 items-center">
                <span className="font-headline text-4xl font-black italic tracking-tight text-outline-variant">
                  {match.status === 'COMPLETED' ? 'Score unavailable' : 'VS'}
                </span>
              </div>
            )}
          </div>

          {/* Away Team */}
          <div className="flex items-center gap-4 flex-1">
            <TeamBadge team={match.awayTeam} size={80} variant="away" />
            <div>
              <h2 className="text-2xl md:text-4xl font-black font-headline tracking-tighter text-secondary leading-none uppercase">
                {match.awayTeam.name}
              </h2>
            </div>
          </div>
        </div>
      </section>

      <MatchActions matchId={match.id} status={match.status} competitionId={match.competitionId} />

      <MatchCoverageNotice status={match.status} features={features} />

      {hasBoxScoreContent && <MatchTabs
        hasPlayByPlay={showScoreFlow || showMatchEvents}
        boxScore={
          <>
            {/* Match Momentum */}
            {showScoreFlow && (
              <div className="bg-surface-container-low rounded-xl p-6 mb-8">
                <h4 className="text-primary-container font-headline font-bold text-sm uppercase tracking-tight mb-4">
                  Match Momentum
                </h4>
                <MatchMomentumChart
                  scoreFlow={match.scoreFlow}
                  homeTeam={match.homeTeam}
                  awayTeam={match.awayTeam}
                />
              </div>
            )}

            {/* Team Stats Comparison */}
            {showPlayerBoxScore && homePlayerStats.length > 0 && awayPlayerStats.length > 0 && (
              <div className="mb-8">
                <MatchStatsComparison stats={comparisonStats} />
              </div>
            )}

            {/* Stats Grid */}
            {(showPlayerBoxScore || mvp || showPeriodScores) && <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
              {/* Left Column: Tables */}
              {showPlayerBoxScore && <div className="xl:col-span-3 space-y-8">
                <PlayerStatsTable team={match.homeTeam} players={homePlayerStats} competitionId={match.competitionId} />
                <PlayerStatsTable team={match.awayTeam} players={awayPlayerStats} competitionId={match.competitionId} />
              </div>}

              {/* Right Column: Sidebar */}
              <div className="space-y-6">
                {/* Transparent, feed-derived top performer card */}
                {mvp && (
                  <div className="bg-surface-container-highest rounded-xl p-6 border-l-4 border-secondary">
                    <div className="flex justify-between items-start mb-4">
                      <span className="bg-secondary text-white text-[10px] font-black px-2 py-1 rounded font-label uppercase tracking-tighter">
                        Top NetPoints
                      </span>
                      <span
                        aria-hidden="true"
                        className="material-symbols-outlined text-secondary"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        star
                      </span>
                    </div>
                    <div className="flex flex-col items-center text-center">
                      <PlayerAvatar
                        decorative
                        name={mvp.player.name}
                        photoUrl={secondaryPlayerPhotoUrl(mvp.player)}
                        size={120}
                        className="mb-3 border-2 border-secondary/20"
                      />
                      <Link prefetch={false} href={editionScopedHref(`/player/${mvp.player.id}`, match.competitionId)} className="hover:underline">
                        <h3 className="font-headline text-xl font-black text-primary-container uppercase">
                          {mvp.player.name}
                        </h3>
                      </Link>
                      <p className="font-label text-xs text-on-surface-variant font-bold uppercase tracking-widest mt-1">
                        {mvp.player.position}
                      </p>
                      <p className="mt-3 font-label text-xs text-on-surface-variant">
                        Highest Champion Data NetPoints rating in this match.
                      </p>
                      <div className="grid grid-cols-3 w-full gap-2 mt-5">
                        <div className="bg-white rounded-lg p-3 shadow-sm">
                          <span className="block text-[10px] font-label font-bold text-on-surface-variant uppercase tracking-widest">
                            NetPts
                          </span>
                          <span className="text-2xl font-black font-headline text-secondary">
                            {mvp.netPoints}
                          </span>
                        </div>
                        {mvpSupportingStats.map((stat) => (
                          <div key={stat.label} className="bg-white rounded-lg p-3 shadow-sm">
                            <span className="block text-[10px] font-label font-bold text-on-surface-variant uppercase tracking-widest">
                              {stat.label}
                            </span>
                            <span className="text-2xl font-black font-headline text-primary-container">
                              {stat.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Quarter Score Bars */}
                {showPeriodScores && (
                  <div className="bg-surface-container-low rounded-xl p-6">
                    <h4 className="text-primary-container font-headline font-bold text-sm uppercase tracking-tight mb-6">
                      Quarter Breakdown
                    </h4>
                    <QuarterScoreBar quarters={match.quarters} />
                  </div>
                )}
              </div>
            </div>}
          </>
        }
        playByPlay={
          <MatchTimeline
            matchId={match.id}
            competitionId={match.competitionId}
            homeTeam={{ id: match.homeTeamId, ...match.homeTeam }}
            awayTeam={{ id: match.awayTeamId, ...match.awayTeam }}
          />
        }
      />}

      {!hasBoxScoreContent && (showScoreFlow || showMatchEvents) && (
        <MatchTimeline
          matchId={match.id}
          competitionId={match.competitionId}
          homeTeam={{ id: match.homeTeamId, ...match.homeTeam }}
          awayTeam={{ id: match.awayTeamId, ...match.awayTeam }}
        />
      )}
    </div>
  );
}
