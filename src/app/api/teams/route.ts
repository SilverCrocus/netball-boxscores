import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getPublicCompetitions } from '@/lib/competitions';

export async function GET(): Promise<NextResponse> {
  try {
    const publicEditionIds = (await getPublicCompetitions()).map((edition) => edition.id);
    const teams = await prisma.team.findMany({
      where: {
        OR: [
          { competitionId: { in: publicEditionIds } },
          { editionEntries: { some: { competitionId: { in: publicEditionIds } } } },
        ],
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        abbreviation: true,
        logoUrl: true,
      },
    });
    return NextResponse.json(teams);
  } catch (error) {
    console.error('Failed to fetch teams:', error);
    return NextResponse.json({ error: 'Failed to fetch teams' }, { status: 500 });
  }
}
