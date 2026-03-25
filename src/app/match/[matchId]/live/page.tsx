import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { LiveGameClient } from './LiveGameClient';

interface Props {
  params: Promise<{ matchId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { matchId } = await params;
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      round: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });

  if (!match) return { title: 'Match Not Found' };

  return {
    title: `LIVE: ${match.homeTeam.name} vs ${match.awayTeam.name} | Round ${match.round}`,
    robots: { index: false },
  };
}

export default async function LiveGamePage({ params }: Props) {
  const { matchId } = await params;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      homeTeam: {
        include: {
          players: {
            include: {
              matchStats: {
                where: { matchId },
              },
            },
          },
        },
      },
      awayTeam: {
        include: {
          players: {
            include: {
              matchStats: {
                where: { matchId },
              },
            },
          },
        },
      },
      quarters: { orderBy: { quarter: 'asc' } },
    },
  });

  if (!match) return notFound();

  function serializeTeam(team: NonNullable<typeof match>['homeTeam']) {
    return {
      id: team.id,
      name: team.name,
      abbreviation: team.abbreviation,
      logoUrl: team.logoUrl,
      players: team.players.map((p) => {
        const stats = p.matchStats[0];
        return {
          id: p.id,
          name: p.name,
          position: p.position,
          goals: stats?.goals ?? 0,
          attempts: stats?.attempts ?? 0,
          goalAssists: stats?.goalAssists ?? 0,
          intercepts: stats?.intercepts ?? 0,
          deflections: stats?.deflections ?? 0,
          rebounds: stats?.rebounds ?? 0,
          feeds: stats?.feeds ?? 0,
          turnovers: stats?.turnovers ?? 0,
        };
      }),
    };
  }

  const serialized = {
    id: match.id,
    round: match.round,
    venue: match.venue,
    status: match.status,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    currentQuarter: match.currentQuarter,
    currentTime: match.currentTime,
    homeTeam: serializeTeam(match.homeTeam),
    awayTeam: serializeTeam(match.awayTeam),
  };

  return <LiveGameClient match={serialized} />;
}
