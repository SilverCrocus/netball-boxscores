import { cache } from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getStatValue, computeShootingPct } from '@/lib/stat-utils';
import { getPositionConfig } from '@/components/player/position-config';
import { PlayerHero } from '@/components/player/PlayerHero';
import { PlayerBioCard } from '@/components/player/PlayerBioCard';
import PlayerSeasonStats from '@/components/player/PlayerSeasonStats';
import PlayerCharts from '@/components/player/PlayerCharts';
import { PlayerGameLog } from '@/components/player/PlayerGameLog';
import { PlayerAdvancedMetrics } from '@/components/player/PlayerAdvancedMetrics';
import { getPlayerAnalyticsProfile } from '@/lib/player-analytics';
import { getPublicCompetitions } from '@/lib/competitions';
import { JsonLd, personJsonLd, breadcrumbJsonLd } from '@/lib/seo';
import type { Metadata } from 'next';

interface PlayerPageProps {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{ edition?: string; season?: string }>;
}

const getPlayer = cache((playerId: string, competitionId: string | undefined, publicEditionIds: string[]) =>
  prisma.player.findFirst({
    where: {
      id: playerId,
      OR: [
        { team: { competitionId: { in: publicEditionIds } } },
        { rosterMemberships: { some: { editionEntry: { competitionId: { in: publicEditionIds } } } } },
      ],
    },
    include: {
      team: true,
      matchStats: {
        where: competitionId ? {
          match: {
            competitionId,
            status: 'COMPLETED',
            resultQuality: { in: ['OFFICIAL_FINAL', 'CORRECTED'] },
            isSimulation: false,
          },
        } : undefined,
        include: {
          match: {
            include: {
              homeTeam: true,
              awayTeam: true,
            },
          },
        },
        orderBy: { match: { scheduledAt: 'desc' } },
      },
      rosterMemberships: {
        where: competitionId ? { editionEntry: { competitionId } } : undefined,
        include: { editionEntry: { include: { team: true, competition: true } } },
        orderBy: { validFrom: 'desc' },
      },
    },
  })
);

const getPlayerSuperShots = cache((playerId: string, matchIds: string[]) =>
  prisma.scoreFlow.groupBy({
    by: ['matchId'],
    where: { scorerPlayerId: playerId, scorePoints: 2, matchId: { in: matchIds } },
    _count: true,
  })
);

export async function generateMetadata({ params }: PlayerPageProps): Promise<Metadata> {
  const { playerId } = await params;
  const publicEditionIds = (await getPublicCompetitions()).map((edition) => edition.id);
  const player = await getPlayer(playerId, undefined, publicEditionIds);

  if (!player) return { title: 'Player Not Found' };

  return {
    title: `${player.name} - ${player.team.name}`,
    description: `${player.name} — ${player.position} for ${player.team.name}. Season stats, game log, and profile.`,
  };
}

type PlayerWithStats = NonNullable<Awaited<ReturnType<typeof getPlayer>>>;

function computeStatHighlightValues(
  player: PlayerWithStats,
  config: ReturnType<typeof getPositionConfig>,
): (number | string)[] {
  const { matchStats } = player;
  if (matchStats.length === 0) return config.highlights.map(() => 0);

  return config.highlights.map((highlight) => {
    if (highlight.statField === 'shootingPct') {
      const totalGoals = matchStats.reduce((sum, s) => sum + s.goals, 0);
      const totalAttempts = matchStats.reduce((sum, s) => sum + s.attempts, 0);
      return computeShootingPct(totalGoals, totalAttempts).toFixed(1);
    }
    const total = matchStats.reduce(
      (sum, s) => sum + getStatValue(s, highlight.statField),
      0,
    );
    return total;
  });
}

export default async function PlayerPage({ params, searchParams }: PlayerPageProps) {
  const { playerId } = await params;
  const { edition, season } = await searchParams;

  const competitions = await getPublicCompetitions();
  const currentCompetition = competitions[0];
  const selectedCompetition = edition
    ? competitions.find((competition) => (competition.slug ?? competition.id) === edition) || currentCompetition
    : season
      ? competitions.find((competition) => competition.season.toString() === season) || currentCompetition
      : currentCompetition;

  const player = await getPlayer(
    playerId,
    selectedCompetition?.id,
    competitions.map((competition) => competition.id),
  );

  if (!player) notFound();

  const config = getPositionConfig(player.position);
  const statHighlightValues = computeStatHighlightValues(player, config);

  const analytics = selectedCompetition
    ? await getPlayerAnalyticsProfile(playerId, selectedCompetition.id, player.position)
    : null;
  const superShotsByMatch = analytics?.superShotMatchIds.length
    ? await getPlayerSuperShots(playerId, analytics.superShotMatchIds)
    : [];
  const totalSuperShots = superShotsByMatch.reduce((sum, g) => sum + g._count, 0);
  const membership = player.rosterMemberships[0]?.editionEntry;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <JsonLd data={personJsonLd({
        name: player.name,
        position: player.position,
        dateOfBirth: player.dateOfBirth,
        nationality: player.nationality,
        teamName: player.team.name,
        teamSlug: player.team.slug,
      })} />
      <JsonLd data={breadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: 'Teams', url: '/teams' },
        { name: player.team.name, url: `/team/${player.team.slug}` },
        { name: player.name, url: `/player/${player.id}` },
      ])} />

      <PlayerHero
        player={player}
        positionConfig={config}
        statHighlightValues={statHighlightValues}
      />

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div className="md:col-span-8">
          <PlayerSeasonStats
            matchStats={player.matchStats}
            positionConfig={config}
            totalSuperShots={analytics?.superShotMatchIds.length ? totalSuperShots : undefined}
            competitions={competitions}
            selectedCompetitionId={selectedCompetition?.id}
            playerId={playerId}
          />
        </div>
        <div className="md:col-span-4">
          <PlayerCharts
            matchStats={player.matchStats}
            positionConfig={config}
          />
        </div>
      </div>

      {analytics && selectedCompetition && (
        <PlayerAdvancedMetrics
          analytics={analytics}
          editionLabel={selectedCompetition.label ?? selectedCompetition.name}
          membershipLabel={membership?.displayName ?? membership?.team.name ?? player.team.name}
        />
      )}

      <PlayerBioCard biography={player.biography ?? null} />

      <PlayerGameLog
        matchStats={player.matchStats}
        config={config}
        playerTeamId={player.teamId}
      />
    </div>
  );
}
