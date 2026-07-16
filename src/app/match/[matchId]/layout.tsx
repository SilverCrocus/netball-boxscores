import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getPublicCompetitions } from '@/lib/competitions';

export default async function PublicMatchLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ matchId: string }>;
}) {
  const [{ matchId }, editions] = await Promise.all([
    params,
    getPublicCompetitions(),
  ]);
  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      competitionId: { in: editions.map((edition) => edition.id) },
    },
    select: { id: true },
  });

  if (!match) notFound();
  return children;
}
