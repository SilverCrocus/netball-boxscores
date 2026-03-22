import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const reminders = await prisma.userReminder.findMany({
    where: { userId: session.user.id },
    include: {
      match: {
        include: { homeTeam: true, awayTeam: true },
      },
    },
  });

  return NextResponse.json(reminders);
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

  const reminder = await prisma.userReminder.create({
    data: {
      userId: session.user.id,
      matchId,
    },
  });

  return NextResponse.json(reminder, { status: 201 });
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

  await prisma.userReminder.delete({
    where: {
      userId_matchId: {
        userId: session.user.id,
        matchId,
      },
    },
  });

  return NextResponse.json({ success: true });
}
