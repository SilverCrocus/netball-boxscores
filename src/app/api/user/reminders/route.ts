import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, badRequest } from '@/lib/api-auth';

export async function GET(): Promise<NextResponse> {
  const { user, error } = await requireAuth();
  if (error) return error;

  const reminders = await prisma.userReminder.findMany({
    where: { userId: user.id },
    include: {
      match: {
        include: { homeTeam: true, awayTeam: true },
      },
    },
  });

  return NextResponse.json(reminders);
}

export async function POST(request: Request): Promise<NextResponse> {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { matchId } = await request.json();
  if (!matchId) return badRequest('matchId is required');

  const reminder = await prisma.userReminder.create({
    data: { userId: user.id, matchId },
  });

  return NextResponse.json(reminder, { status: 201 });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { matchId } = await request.json();
  if (!matchId) return badRequest('matchId is required');

  await prisma.userReminder.delete({
    where: {
      userId_matchId: { userId: user.id, matchId },
    },
  });

  return NextResponse.json({ success: true });
}
