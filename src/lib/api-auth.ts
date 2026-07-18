import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

interface AuthenticatedUser {
  id: string;
  name?: string | null;
  email?: string | null;
}

type AuthResult =
  | { user: AuthenticatedUser; error: null }
  | { user: null; error: NextResponse };

export async function requireAuth(): Promise<AuthResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return {
      user: null,
      error: NextResponse.json({ error: 'Unauthorized' }, {
        status: 401,
        headers: { 'Cache-Control': 'private, no-store' },
      }),
    };
  }
  return { user: session.user as AuthenticatedUser, error: null };
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, {
    status: 400,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
