import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getPublicCompetitions } from '@/lib/competitions';
import { safeErrorMessage } from '@/lib/safe-logging';

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
      take: 256,
    });
    return NextResponse.json(teams, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    console.error('Failed to fetch teams:', safeErrorMessage(error));
    return NextResponse.json({ error: 'Failed to fetch teams' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
