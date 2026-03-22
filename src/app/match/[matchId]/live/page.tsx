import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { LiveGameClient } from './LiveGameClient';

interface Props {
  params: Promise<{ matchId: string }>;
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

  // Serialize the match data for the client component
  const serialized = {
    id: match.id,
    round: match.round,
    venue: match.venue,
    status: match.status,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    currentQuarter: match.currentQuarter,
    currentTime: match.currentTime,
    homeTeam: {
      id: match.homeTeam.id,
      name: match.homeTeam.name,
      abbreviation: match.homeTeam.abbreviation,
      logoUrl: match.homeTeam.logoUrl,
      players: match.homeTeam.players.map((p) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        goals: p.matchStats[0]?.goals ?? 0,
        attempts: p.matchStats[0]?.attempts ?? 0,
        goalAssists: p.matchStats[0]?.goalAssists ?? 0,
        intercepts: p.matchStats[0]?.intercepts ?? 0,
        deflections: p.matchStats[0]?.deflections ?? 0,
        rebounds: p.matchStats[0]?.rebounds ?? 0,
        feeds: p.matchStats[0]?.feeds ?? 0,
        turnovers: p.matchStats[0]?.turnovers ?? 0,
      })),
    },
    awayTeam: {
      id: match.awayTeam.id,
      name: match.awayTeam.name,
      abbreviation: match.awayTeam.abbreviation,
      logoUrl: match.awayTeam.logoUrl,
      players: match.awayTeam.players.map((p) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        goals: p.matchStats[0]?.goals ?? 0,
        attempts: p.matchStats[0]?.attempts ?? 0,
        goalAssists: p.matchStats[0]?.goalAssists ?? 0,
        intercepts: p.matchStats[0]?.intercepts ?? 0,
        deflections: p.matchStats[0]?.deflections ?? 0,
        rebounds: p.matchStats[0]?.rebounds ?? 0,
        feeds: p.matchStats[0]?.feeds ?? 0,
        turnovers: p.matchStats[0]?.turnovers ?? 0,
      })),
    },
  };

  return <LiveGameClient match={serialized} />;
}
