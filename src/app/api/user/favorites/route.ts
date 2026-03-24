import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, badRequest } from '@/lib/api-auth';

export async function GET(): Promise<NextResponse> {
  const { user, error } = await requireAuth();
  if (error) return error;

  const favorites = await prisma.userFavorite.findMany({
    where: { userId: user.id },
    include: {
      match: {
        include: { homeTeam: true, awayTeam: true },
      },
    },
  });

  return NextResponse.json(favorites);
}

export async function POST(request: Request): Promise<NextResponse> {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { matchId } = await request.json();
  if (!matchId) return badRequest('matchId is required');

  const favorite = await prisma.userFavorite.create({
    data: { userId: user.id, matchId },
  });

  return NextResponse.json(favorite, { status: 201 });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { matchId } = await request.json();
  if (!matchId) return badRequest('matchId is required');

  await prisma.userFavorite.delete({
    where: {
      userId_matchId: { userId: user.id, matchId },
    },
  });

  return NextResponse.json({ success: true });
}
