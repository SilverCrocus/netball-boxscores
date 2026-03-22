import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { CourtClient } from './CourtClient';

interface Props {
  params: Promise<{ matchId: string }>;
}

export default async function CourtPage({ params }: Props) {
  const { matchId } = await params;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      homeTeam: {
        include: {
          players: {
            include: {
              matchStats: { where: { matchId } },
            },
          },
        },
      },
      awayTeam: {
        include: {
          players: {
            include: {
              matchStats: { where: { matchId } },
            },
          },
        },
      },
    },
  });

  if (!match) return notFound();

  return <CourtClient match={match} />;
}
