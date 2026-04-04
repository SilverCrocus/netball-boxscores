import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { LiveGameClient } from './LiveGameClient';
import { pickStatFields, emptyStats } from '@/lib/stat-utils';

interface Props {
  params: Promise<{ matchId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { matchId } = await params;
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      status: true,
      round: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });

  if (!match) return { title: 'Match Not Found' };

  const statusPrefix = match.status === 'COMPLETED' ? 'Full Time:' : 'LIVE:';

  return {
    title: `${statusPrefix} ${match.homeTeam.name} vs ${match.awayTeam.name} | Round ${match.round}`,
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
      scoreFlow: {
        orderBy: [{ period: 'asc' }, { periodSeconds: 'asc' }],
        select: {
          period: true,
          periodSeconds: true,
          scoringTeamId: true,
          homeScore: true,
          awayScore: true,
          scorePoints: true,
          scorerPlayer: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!match) return notFound();

  function serializeTeam(team: NonNullable<typeof match>['homeTeam']) {
    return {
      id: team.id,
      name: team.name,
      abbreviation: team.abbreviation,
      logoUrl: team.logoUrl,
      primaryColor: team.primaryColor,
      players: team.players.map((p) => {
        const stats = p.matchStats[0];
        return {
          id: p.id,
          name: p.name,
          position: p.position,
          ...(stats ? pickStatFields(stats) : emptyStats()),
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
    quarters: match.quarters.map((q) => ({
      quarter: q.quarter,
      homeScore: q.homeScore,
      awayScore: q.awayScore,
    })),
    initialScoreFlow: match.scoreFlow.map((sf) => ({
      matchId: match.id,
      period: sf.period,
      periodSeconds: sf.periodSeconds,
      scoringTeamId: sf.scoringTeamId,
      homeScore: sf.homeScore,
      awayScore: sf.awayScore,
      scorePoints: sf.scorePoints,
      scorerPlayerId: sf.scorerPlayer?.id,
      scorerName: sf.scorerPlayer?.name,
    })),
  };

  return <LiveGameClient match={serialized} />;
}
