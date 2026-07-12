import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, badRequest } from '@/lib/api-auth';

type UserResourceConfig =
  | { model: 'userFavorite'; foreignKey: 'matchId'; include?: Record<string, unknown> }
  | { model: 'userReminder'; foreignKey: 'matchId'; include?: Record<string, unknown> }
  | { model: 'userTeam'; foreignKey: 'teamId'; include?: Record<string, unknown> };

interface UserResourceDelegate {
  findMany(args: Record<string, unknown>): Promise<unknown>;
  findUnique(args: Record<string, unknown>): Promise<unknown>;
  create(args: Record<string, unknown>): Promise<unknown>;
  delete(args: Record<string, unknown>): Promise<unknown>;
}

function getDelegate(model: UserResourceConfig['model']): UserResourceDelegate {
  return prisma[model] as unknown as UserResourceDelegate;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

async function readForeignKey(request: Request, foreignKey: string): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null) return null;
    const value = (body as Record<string, unknown>)[foreignKey];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function createUserResourceHandlers(config: UserResourceConfig) {
  const delegate = getDelegate(config.model);
  const compoundKey = `userId_${config.foreignKey}`;

  async function GET(): Promise<NextResponse> {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    const { user } = auth;

    const items = await delegate.findMany({
      where: { userId: user.id },
      ...(config.include ? { include: config.include } : {}),
    });

    return NextResponse.json(items);
  }

  async function POST(request: Request): Promise<NextResponse> {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    const { user } = auth;

    const foreignKeyValue = await readForeignKey(request, config.foreignKey);
    if (!foreignKeyValue) return badRequest(`${config.foreignKey} is required`);

    const where = {
      [compoundKey]: { userId: user.id, [config.foreignKey]: foreignKeyValue },
    };
    let item: unknown;
    try {
      item = await delegate.create({
        data: { userId: user.id, [config.foreignKey]: foreignKeyValue },
      });
    } catch (createError) {
      if (!hasErrorCode(createError, 'P2002')) throw createError;
      item = await delegate.findUnique({ where });
      return NextResponse.json(item, { status: 200 });
    }

    return NextResponse.json(item, { status: 201 });
  }

  async function DELETE(request: Request): Promise<NextResponse> {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    const { user } = auth;

    const foreignKeyValue = await readForeignKey(request, config.foreignKey);
    if (!foreignKeyValue) return badRequest(`${config.foreignKey} is required`);

    try {
      await delegate.delete({
        where: {
          [compoundKey]: { userId: user.id, [config.foreignKey]: foreignKeyValue },
        },
      });
    } catch (deleteError) {
      if (!hasErrorCode(deleteError, 'P2025')) throw deleteError;
    }

    return NextResponse.json({ success: true });
  }

  return { GET, POST, DELETE };
}
