import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const teams = await prisma.userTeam.findMany({
    where: { userId: session.user.id },
    include: { team: true },
  });

  return NextResponse.json(teams);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { teamId } = await request.json();
  if (!teamId) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 });
  }

  const userTeam = await prisma.userTeam.create({
    data: {
      userId: session.user.id,
      teamId,
    },
  });

  return NextResponse.json(userTeam, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { teamId } = await request.json();
  if (!teamId) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 });
  }

  await prisma.userTeam.delete({
    where: {
      userId_teamId: {
        userId: session.user.id,
        teamId,
      },
    },
  });

  return NextResponse.json({ success: true });
}
