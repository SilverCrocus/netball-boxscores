import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, badRequest } from '@/lib/api-auth';

interface UserResourceConfig {
  /** Prisma delegate name, e.g. 'userFavorite' */
  model: keyof typeof prisma & string;
  /** The foreign key field name, e.g. 'matchId' or 'teamId' */
  foreignKey: string;
  /** Include config for GET queries */
  include?: Record<string, unknown>;
}

export function createUserResourceHandlers(config: UserResourceConfig) {
  const delegate = prisma[config.model] as any;
  const compoundKey = `userId_${config.foreignKey}`;

  async function GET(): Promise<NextResponse> {
    const { user, error } = await requireAuth();
    if (error) return error;

    const items = await delegate.findMany({
      where: { userId: user.id },
      ...(config.include ? { include: config.include } : {}),
    });

    return NextResponse.json(items);
  }

  async function POST(request: Request): Promise<NextResponse> {
    const { user, error } = await requireAuth();
    if (error) return error;

    const body = await request.json();
    const foreignKeyValue = body[config.foreignKey];
    if (!foreignKeyValue) return badRequest(`${config.foreignKey} is required`);

    const item = await delegate.create({
      data: { userId: user.id, [config.foreignKey]: foreignKeyValue },
    });

    return NextResponse.json(item, { status: 201 });
  }

  async function DELETE(request: Request): Promise<NextResponse> {
    const { user, error } = await requireAuth();
    if (error) return error;

    const body = await request.json();
    const foreignKeyValue = body[config.foreignKey];
    if (!foreignKeyValue) return badRequest(`${config.foreignKey} is required`);

    await delegate.delete({
      where: {
        [compoundKey]: { userId: user.id, [config.foreignKey]: foreignKeyValue },
      },
    });

    return NextResponse.json({ success: true });
  }

  return { GET, POST, DELETE };
}
