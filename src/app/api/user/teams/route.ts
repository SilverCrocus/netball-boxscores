import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, badRequest } from '@/lib/api-auth';

export async function GET(): Promise<NextResponse> {
  const { user, error } = await requireAuth();
  if (error) return error;

  const teams = await prisma.userTeam.findMany({
    where: { userId: user.id },
    include: { team: true },
  });

  return NextResponse.json(teams);
}

export async function POST(request: Request): Promise<NextResponse> {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { teamId } = await request.json();
  if (!teamId) return badRequest('teamId is required');

  const userTeam = await prisma.userTeam.create({
    data: { userId: user.id, teamId },
  });

  return NextResponse.json(userTeam, { status: 201 });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { teamId } = await request.json();
  if (!teamId) return badRequest('teamId is required');

  await prisma.userTeam.delete({
    where: {
      userId_teamId: { userId: user.id, teamId },
    },
  });

  return NextResponse.json({ success: true });
}
