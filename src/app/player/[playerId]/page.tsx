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
import { JsonLd, personJsonLd, breadcrumbJsonLd } from '@/lib/seo';
import type { Metadata } from 'next';

interface PlayerPageProps {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{ season?: string }>;
}

const getPlayer = cache((playerId: string, competitionId?: string) =>
  prisma.player.findUnique({
    where: { id: playerId },
    include: {
      team: true,
      matchStats: {
        where: competitionId ? { match: { competitionId } } : undefined,
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
    },
  })
);

const getCompetitions = cache(() =>
  prisma.competition.findMany({
    select: { id: true, season: true, name: true },
    orderBy: { season: 'desc' },
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
  const player = await getPlayer(playerId);

  if (!player) return { title: 'Player Not Found' };

  return {
    title: `${player.name} - ${player.team.name}`,
    description: `${player.name} — ${player.position} for ${player.team.name}. Season stats, game log, and profile.`,
  };
}

function computeImpact(stats: { goals: number; goalAssists: number; intercepts: number; deflections: number; rebounds: number; turnovers: number; penalties: number }[]): number {
  return stats.reduce((sum, s) => sum + s.goals + s.goalAssists + s.intercepts + s.deflections + s.rebounds - s.turnovers - s.penalties, 0);
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
  const { season } = await searchParams;

  const competitions = await getCompetitions();
  const currentCompetition = competitions[0];
  const selectedCompetition = season
    ? competitions.find((c) => c.season.toString() === season) || currentCompetition
    : currentCompetition;

  const player = await getPlayer(playerId, selectedCompetition?.id);

  if (!player) notFound();

  const config = getPositionConfig(player.position);
  const statHighlightValues = computeStatHighlightValues(player, config);

  const matchIds = player.matchStats.map((ms) => ms.matchId);
  const superShotsByMatch = await getPlayerSuperShots(playerId, matchIds);
  const totalSuperShots = superShotsByMatch.reduce((sum, g) => sum + g._count, 0);
  const impactTotal = computeImpact(player.matchStats);
  const gamesPlayed = player.matchStats.length;

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
            totalSuperShots={totalSuperShots}
            impactTotal={impactTotal}
            competitions={competitions}
            selectedSeason={selectedCompetition?.season ?? currentCompetition?.season}
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

      <PlayerBioCard biography={player.biography ?? null} />

      <PlayerGameLog
        matchStats={player.matchStats}
        config={config}
        playerTeamId={player.teamId}
      />
    </div>
  );
}
