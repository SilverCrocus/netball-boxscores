import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/email';
import {
  clientIdentifier,
  consumeRateLimit,
  isSameOriginRequest,
  readJsonObjectWithinLimit,
} from '@/lib/request-security';
import { safeErrorMessage } from '@/lib/safe-logging';

const SIGNUP_BODY_LIMIT = 4_096;
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin signup requests are not allowed' }, {
      status: 403,
      headers: PRIVATE_HEADERS,
    });
  }

  const rate = consumeRateLimit({
    scope: 'signup-ip',
    identifier: clientIdentifier(request.headers),
    limit: 5,
    windowMs: 15 * 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many signup attempts. Try again later.' }, {
      status: 429,
      headers: { ...PRIVATE_HEADERS, 'Retry-After': String(rate.retryAfterSeconds) },
    });
  }

  try {
    const body = await readJsonObjectWithinLimit(request, SIGNUP_BODY_LIMIT);
    if (!body.ok) {
      return NextResponse.json({ error: body.message }, {
        status: body.status,
        headers: PRIVATE_HEADERS,
      });
    }
    const { name, email, password } = body.value;

    if (typeof email !== 'string' || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400, headers: PRIVATE_HEADERS }
      );
    }

    const normalizedEmail = normalizeEmail(email);
    if (
      !normalizedEmail
      || normalizedEmail.length > 254
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      return NextResponse.json(
        { error: 'A valid email address is required' },
        { status: 400, headers: PRIVATE_HEADERS }
      );
    }

    if (password.length < 8 || password.length > 128) {
      return NextResponse.json(
        { error: 'Password must be between 8 and 128 characters' },
        { status: 400, headers: PRIVATE_HEADERS }
      );
    }

    const normalizedName = typeof name === 'string' ? name.trim() : '';
    if (normalizedName.length > 100 || /[\u0000-\u001f\u007f]/.test(normalizedName)) {
      return NextResponse.json({ error: 'Name must be 100 characters or fewer' }, {
        status: 400,
        headers: PRIVATE_HEADERS,
      });
    }

    // Perform the same expensive password work for new and existing accounts
    // so the response does not become a cheap account-enumeration oracle.
    const passwordHash = await bcrypt.hash(password, 12);

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      return NextResponse.json({ success: true }, { status: 201, headers: PRIVATE_HEADERS });
    }

    await prisma.user.create({
      data: {
        name: normalizedName || undefined,
        email: normalizedEmail,
        passwordHash,
      },
    });

    return NextResponse.json({ success: true }, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    if (hasErrorCode(error, 'P2002')) {
      return NextResponse.json({ success: true }, { status: 201, headers: PRIVATE_HEADERS });
    }
    console.error('Signup failed:', safeErrorMessage(error));
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: PRIVATE_HEADERS }
    );
  }
}
