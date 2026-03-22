import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const favorites = await prisma.userFavorite.findMany({
    where: { userId: session.user.id },
    include: {
      match: {
        include: { homeTeam: true, awayTeam: true },
      },
    },
  });

  return NextResponse.json(favorites);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { matchId } = await request.json();
  if (!matchId) {
    return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
  }

  const favorite = await prisma.userFavorite.create({
    data: {
      userId: session.user.id,
      matchId,
    },
  });

  return NextResponse.json(favorite, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { matchId } = await request.json();
  if (!matchId) {
    return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
  }

  await prisma.userFavorite.delete({
    where: {
      userId_matchId: {
        userId: session.user.id,
        matchId,
      },
    },
  });

  return NextResponse.json({ success: true });
}
