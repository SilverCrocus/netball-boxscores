import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, badRequest } from '@/lib/api-auth';
import {
  resolvePublicMatchAccess,
  resolvePublicMatchAccessBatch,
} from '@/lib/public-match';
import { resolvePublicTeamIds } from '@/lib/public-team';
import {
  consumeRateLimit,
  isSameOriginRequest,
  readJsonObjectWithinLimit,
} from '@/lib/request-security';

const MAX_USER_RESOURCES = 100;
const USER_RESOURCE_BODY_LIMIT = 1_024;
const CANONICAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

type UserResourceConfig =
  | { model: 'userFavorite'; foreignKey: 'matchId'; include?: Record<string, unknown> }
  | { model: 'userReminder'; foreignKey: 'matchId'; include?: Record<string, unknown> }
  | { model: 'userTeam'; foreignKey: 'teamId'; include?: Record<string, unknown> };

interface UserResourceDelegate {
  findMany(args: Record<string, unknown>): Promise<unknown[]>;
  findUnique(args: Record<string, unknown>): Promise<unknown>;
  count(args: Record<string, unknown>): Promise<number>;
  create(args: Record<string, unknown>): Promise<unknown>;
  delete(args: Record<string, unknown>): Promise<unknown>;
}

function getDelegate(model: UserResourceConfig['model']): UserResourceDelegate {
  return prisma[model] as unknown as UserResourceDelegate;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function resourceId(item: unknown, foreignKey: string): string | null {
  if (!item || typeof item !== 'object') return null;
  const value = (item as Record<string, unknown>)[foreignKey];
  return typeof value === 'string' ? value : null;
}

async function publicResourceIds(
  foreignKey: UserResourceConfig['foreignKey'],
  ids: string[],
): Promise<ReadonlySet<string>> {
  if (ids.length === 0) return new Set();
  if (foreignKey === 'matchId') {
    return new Set((await resolvePublicMatchAccessBatch(ids)).keys());
  }

  return resolvePublicTeamIds(ids);
}

async function isPublicResource(
  foreignKey: UserResourceConfig['foreignKey'],
  id: string,
): Promise<boolean> {
  if (foreignKey === 'matchId') return Boolean(await resolvePublicMatchAccess(id));
  return (await publicResourceIds(foreignKey, [id])).has(id);
}

function privateJson(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, { status, headers: PRIVATE_HEADERS });
}

function rejectCrossOrigin(request: Request): NextResponse | null {
  return isSameOriginRequest(request)
    ? null
    : privateJson({ error: 'Cross-origin mutations are not allowed' }, 403);
}

function mutationRateLimit(userId: string): NextResponse | null {
  const decision = consumeRateLimit({
    scope: 'user-resource-mutation',
    identifier: userId,
    limit: 120,
    windowMs: 15 * 60_000,
  });
  return decision.allowed
    ? null
    : NextResponse.json({ error: 'Too many requests' }, {
        status: 429,
        headers: { ...PRIVATE_HEADERS, 'Retry-After': String(decision.retryAfterSeconds) },
      });
}

async function readForeignKey(
  request: Request,
  foreignKey: string,
): Promise<string | NextResponse> {
  const body = await readJsonObjectWithinLimit(request, USER_RESOURCE_BODY_LIMIT);
  if (!body.ok) return privateJson({ error: body.message }, body.status);
  const keys = Object.keys(body.value);
  const value = body.value[foreignKey];
  if (
    keys.length !== 1
    || keys[0] !== foreignKey
    || typeof value !== 'string'
    || !CANONICAL_ID.test(value.trim())
  ) {
    return badRequest(`${foreignKey} is required and must be a canonical identifier`);
  }
  return value.trim();
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
      take: MAX_USER_RESOURCES,
    });
    const ids = items.flatMap((item) => {
      const id = resourceId(item, config.foreignKey);
      return id ? [id] : [];
    });
    const allowedIds = await publicResourceIds(config.foreignKey, ids);
    return privateJson(items.filter((item) => {
      const id = resourceId(item, config.foreignKey);
      return id !== null && allowedIds.has(id);
    }));
  }

  async function POST(request: Request): Promise<NextResponse> {
    const originError = rejectCrossOrigin(request);
    if (originError) return originError;
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    const { user } = auth;
    const rateError = mutationRateLimit(user.id);
    if (rateError) return rateError;

    const foreignKeyValue = await readForeignKey(request, config.foreignKey);
    if (foreignKeyValue instanceof NextResponse) return foreignKeyValue;
    if (!await isPublicResource(config.foreignKey, foreignKeyValue)) {
      return privateJson({ error: 'Resource not found' }, 404);
    }

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
      return privateJson(item, 200);
    }

    const resourceCount = await delegate.count({ where: { userId: user.id } });
    if (resourceCount > MAX_USER_RESOURCES) {
      await delegate.delete({ where });
      return privateJson({ error: `At most ${MAX_USER_RESOURCES} saved items are allowed` }, 409);
    }

    return privateJson(item, 201);
  }

  async function DELETE(request: Request): Promise<NextResponse> {
    const originError = rejectCrossOrigin(request);
    if (originError) return originError;
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    const { user } = auth;
    const rateError = mutationRateLimit(user.id);
    if (rateError) return rateError;

    const foreignKeyValue = await readForeignKey(request, config.foreignKey);
    if (foreignKeyValue instanceof NextResponse) return foreignKeyValue;

    try {
      await delegate.delete({
        where: {
          [compoundKey]: { userId: user.id, [config.foreignKey]: foreignKeyValue },
        },
      });
    } catch (deleteError) {
      if (!hasErrorCode(deleteError, 'P2025')) throw deleteError;
    }

    return privateJson({ success: true });
  }

  return { GET, POST, DELETE };
}
