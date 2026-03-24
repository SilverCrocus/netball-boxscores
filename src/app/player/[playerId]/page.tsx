import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getPositionConfig } from '@/components/player/position-config';
import { PlayerHero } from '@/components/player/PlayerHero';
import { PlayerBioCard } from '@/components/player/PlayerBioCard';
import PlayerSeasonStats from '@/components/player/PlayerSeasonStats';
import PlayerCharts from '@/components/player/PlayerCharts';
import { PlayerGameLog } from '@/components/player/PlayerGameLog';
import type { Metadata } from 'next';

interface PlayerPageProps {
  params: Promise<{ playerId: string }>;
}

export async function generateMetadata({ params }: PlayerPageProps): Promise<Metadata> {
  const { playerId } = await params;
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { team: { select: { name: true } } },
  });

  if (!player) return { title: 'Player Not Found | CentrePass' };

  return {
    title: `${player.name} | ${player.team.name} | CentrePass`,
    description: `${player.name} — ${player.position} for ${player.team.name}. Season stats, game log, and profile.`,
  };
}

async function getPlayer(playerId: string) {
  return prisma.player.findUnique({
    where: { id: playerId },
    include: {
      team: true,
      matchStats: {
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
  });
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
      return totalAttempts > 0
        ? ((totalGoals / totalAttempts) * 100).toFixed(1)
        : '0.0';
    }
    const total = matchStats.reduce((sum, s) => {
      const val = (s as unknown as Record<string, number>)[highlight.statField];
      return sum + (typeof val === 'number' ? val : 0);
    }, 0);
    return total;
  });
}

export default async function PlayerPage({ params }: PlayerPageProps) {
  const { playerId } = await params;
  const player = await getPlayer(playerId);

  if (!player) notFound();

  const config = getPositionConfig(player.position);
  const statHighlightValues = computeStatHighlightValues(player, config);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
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
