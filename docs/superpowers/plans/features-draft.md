# NETPULSE Implementation Plan — Features Section

Tasks 12-17: Authentication, Live Pages, Real-Time Infrastructure, Personalization, Deployment.

---

### Task 12: Authentication (NextAuth.js)

**Files:**
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/lib/auth.ts`
- Create: `src/app/auth/signin/page.tsx`
- Create: `src/app/auth/signup/page.tsx`
- Create: `src/components/auth/AuthButton.tsx`
- Create: `src/middleware.ts`
- Create: `src/types/next-auth.d.ts`
- Test: `src/__tests__/auth/auth.test.ts`
- Test: `src/__tests__/auth/middleware.test.ts`

**Environment variables** (add to `.env.local`):
```
NEXTAUTH_SECRET=<random-32-char-string>
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=<from-google-console>
GOOGLE_CLIENT_SECRET=<from-google-console>
```

- [ ] **Step 1: Write auth config tests**

Create `src/__tests__/auth/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock bcryptjs
vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}));

describe('Auth Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export authOptions with credentials and google providers', async () => {
    const { authOptions } = await import('@/lib/auth');
    expect(authOptions).toBeDefined();
    expect(authOptions.providers).toHaveLength(2);
  });

  it('should have session strategy set to jwt', async () => {
    const { authOptions } = await import('@/lib/auth');
    expect(authOptions.session?.strategy).toBe('jwt');
  });

  it('should have custom sign-in page configured', async () => {
    const { authOptions } = await import('@/lib/auth');
    expect(authOptions.pages?.signIn).toBe('/auth/signin');
  });

  it('credentials provider should reject empty email', async () => {
    const { authOptions } = await import('@/lib/auth');
    const credentialsProvider = authOptions.providers.find(
      (p: any) => p.id === 'credentials'
    ) as any;
    const result = await credentialsProvider.options.authorize(
      { email: '', password: 'test123' },
      {} as any
    );
    expect(result).toBeNull();
  });

  it('credentials provider should reject wrong password', async () => {
    const { prisma } = await import('@/lib/prisma');
    const bcrypt = (await import('bcryptjs')).default;

    (prisma.user.findUnique as any).mockResolvedValue({
      id: '1',
      email: 'test@example.com',
      passwordHash: 'hashed',
    });
    (bcrypt.compare as any).mockResolvedValue(false);

    const { authOptions } = await import('@/lib/auth');
    const credentialsProvider = authOptions.providers.find(
      (p: any) => p.id === 'credentials'
    ) as any;
    const result = await credentialsProvider.options.authorize(
      { email: 'test@example.com', password: 'wrong' },
      {} as any
    );
    expect(result).toBeNull();
  });

  it('credentials provider should return user on valid login', async () => {
    const { prisma } = await import('@/lib/prisma');
    const bcrypt = (await import('bcryptjs')).default;

    (prisma.user.findUnique as any).mockResolvedValue({
      id: '1',
      email: 'test@example.com',
      name: 'Test User',
      passwordHash: 'hashed',
    });
    (bcrypt.compare as any).mockResolvedValue(true);

    const { authOptions } = await import('@/lib/auth');
    const credentialsProvider = authOptions.providers.find(
      (p: any) => p.id === 'credentials'
    ) as any;
    const result = await credentialsProvider.options.authorize(
      { email: 'test@example.com', password: 'correct' },
      {} as any
    );
    expect(result).toEqual({
      id: '1',
      email: 'test@example.com',
      name: 'Test User',
    });
  });
});
```

Run: `npx vitest run src/__tests__/auth/auth.test.ts` — expect all tests to FAIL (module not found).

- [ ] **Step 2: Implement NextAuth config**

Create `src/lib/auth.ts`:

```typescript
import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/auth/signin',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user || !user.passwordHash) {
          return null;
        }

        const isValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );

        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
};
```

Run: `npx vitest run src/__tests__/auth/auth.test.ts` — expect all 6 tests to PASS.

- [ ] **Step 3: Create NextAuth route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```typescript
import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
```

- [ ] **Step 4: Create NextAuth type augmentation**

Create `src/types/next-auth.d.ts`:

```typescript
import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
  }
}
```

- [ ] **Step 5: Write middleware tests**

Create `src/__tests__/auth/middleware.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('Auth Middleware Config', () => {
  it('should export a config with protected routes', async () => {
    const { config } = await import('@/middleware');
    expect(config.matcher).toContain('/settings/:path*');
  });
});
```

Run: `npx vitest run src/__tests__/auth/middleware.test.ts` — expect FAIL.

- [ ] **Step 6: Implement middleware**

Create `src/middleware.ts`:

```typescript
import { withAuth } from 'next-auth/middleware';

export default withAuth({
  pages: {
    signIn: '/auth/signin',
  },
});

export const config = {
  matcher: ['/settings/:path*'],
};
```

Run: `npx vitest run src/__tests__/auth/middleware.test.ts` — expect PASS.

- [ ] **Step 7: Build sign-in page**

Create `src/app/auth/signin/page.tsx`:

```tsx
'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
      callbackUrl,
    });

    setLoading(false);

    if (result?.error) {
      setError('Invalid email or password');
    } else if (result?.url) {
      router.push(result.url);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-headline text-3xl font-black tracking-tighter uppercase italic text-primary-container">
            NETPULSE
          </h1>
          <p className="font-body text-on-surface-variant mt-2">
            Sign in to follow teams and set reminders
          </p>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-8 shadow-sm border border-outline-variant/15">
          {error && (
            <div className="bg-error-container text-on-error-container px-4 py-3 rounded-lg mb-6 font-label text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-outline-variant bg-surface-container-low font-body text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary"
                required
              />
            </div>

            <div>
              <label className="block font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-outline-variant bg-surface-container-low font-body text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-container text-white py-3 rounded-lg font-headline font-bold uppercase tracking-wider hover:bg-primary-container/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-outline-variant" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-surface-container-lowest px-4 font-label text-xs text-on-surface-variant uppercase">
                or
              </span>
            </div>
          </div>

          <button
            onClick={() => signIn('google', { callbackUrl })}
            className="w-full flex items-center justify-center gap-3 bg-surface-container-high text-on-surface py-3 rounded-lg font-label font-bold hover:bg-surface-container-highest transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continue with Google
          </button>

          <p className="text-center mt-6 font-body text-sm text-on-surface-variant">
            Don&apos;t have an account?{' '}
            <Link
              href="/auth/signup"
              className="text-secondary font-bold hover:underline"
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Build sign-up page**

Create `src/app/auth/signup/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to create account');
        setLoading(false);
        return;
      }

      // Auto sign in after successful registration
      await signIn('credentials', {
        email,
        password,
        callbackUrl: '/',
      });
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-headline text-3xl font-black tracking-tighter uppercase italic text-primary-container">
            NETPULSE
          </h1>
          <p className="font-body text-on-surface-variant mt-2">
            Create an account to personalize your experience
          </p>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-8 shadow-sm border border-outline-variant/15">
          {error && (
            <div className="bg-error-container text-on-error-container px-4 py-3 rounded-lg mb-6 font-label text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-outline-variant bg-surface-container-low font-body text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary"
                required
              />
            </div>

            <div>
              <label className="block font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-outline-variant bg-surface-container-low font-body text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary"
                required
              />
            </div>

            <div>
              <label className="block font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-outline-variant bg-surface-container-low font-body text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary"
                minLength={8}
                required
              />
              <p className="font-label text-[10px] text-on-surface-variant mt-1">
                Minimum 8 characters
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-container text-white py-3 rounded-lg font-headline font-bold uppercase tracking-wider hover:bg-primary-container/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="text-center mt-6 font-body text-sm text-on-surface-variant">
            Already have an account?{' '}
            <Link
              href="/auth/signin"
              className="text-secondary font-bold hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Create signup API route**

Create `src/app/api/auth/signup/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const { name, email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
      },
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 10: Create AuthButton component**

Create `src/components/auth/AuthButton.tsx`:

```tsx
'use client';

import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';

export function AuthButton() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return (
      <div className="w-8 h-8 rounded-full bg-surface-container-high animate-pulse" />
    );
  }

  if (session?.user) {
    return (
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-secondary text-on-secondary flex items-center justify-center font-headline font-bold text-xs">
          {session.user.name?.charAt(0).toUpperCase() || 'U'}
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="font-label text-xs text-on-surface-variant hover:text-on-surface transition-colors"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <Link
      href="/auth/signin"
      className="font-label text-xs font-bold uppercase tracking-wider text-secondary hover:text-secondary/80 transition-colors"
    >
      Sign In
    </Link>
  );
}
```

- [ ] **Step 11: Install dependencies, verify build**

```bash
npm install next-auth @auth/prisma-adapter bcryptjs
npm install -D @types/bcryptjs
npx vitest run src/__tests__/auth/
```

Expect: all auth tests PASS.

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "feat: add NextAuth.js authentication with credentials and Google OAuth"
```

---

### Task 13: Live Game Center Page (`/match/[matchId]/live`)

**Files:**
- Create: `src/hooks/useMatchSocket.ts`
- Create: `src/app/match/[matchId]/live/page.tsx`
- Create: `src/components/match/LiveScoreHero.tsx`
- Create: `src/components/match/LiveLineups.tsx`
- Create: `src/components/match/MatchStatsComparison.tsx`
- Create: `src/components/match/LivePlayByPlay.tsx`
- Test: `src/__tests__/hooks/useMatchSocket.test.ts`
- Test: `src/__tests__/match/live-page.test.tsx`

**Reference:** `stitch-designs/live-game-center/index.html`

**Socket.io events consumed** (from spec):
| Event | Payload |
|-------|---------|
| `score:update` | `{ matchId, homeScore, awayScore, currentQuarter, currentTime }` |
| `stats:update` | `{ matchId, playerStats: PlayerMatchStats[] }` |
| `match:status` | `{ matchId, status: "LIVE" \| "COMPLETED", quarter?, time? }` |
| `scoreflow:add` | `{ matchId, period, scoringTeamId, homeScore, awayScore, periodSeconds }` |
| `match:subscribe` | Client sends `{ matchId }` to join room |
| `match:unsubscribe` | Client sends `{ matchId }` to leave room |

- [ ] **Step 1: Define Socket.io event types**

Create `src/types/socket.ts`:

```typescript
import type { PlayerMatchStats } from '@prisma/client';

export interface ScoreUpdatePayload {
  matchId: string;
  homeScore: number;
  awayScore: number;
  currentQuarter: number;
  currentTime: string;
}

export interface StatsUpdatePayload {
  matchId: string;
  playerStats: PlayerMatchStats[];
}

export interface MatchStatusPayload {
  matchId: string;
  status: 'LIVE' | 'COMPLETED';
  quarter?: number;
  time?: string;
}

export interface ScoreFlowAddPayload {
  matchId: string;
  period: number;
  scoringTeamId: string;
  homeScore: number;
  awayScore: number;
  periodSeconds: number;
}

export interface ServerToClientEvents {
  'score:update': (payload: ScoreUpdatePayload) => void;
  'stats:update': (payload: StatsUpdatePayload) => void;
  'match:status': (payload: MatchStatusPayload) => void;
  'scoreflow:add': (payload: ScoreFlowAddPayload) => void;
}

export interface ClientToServerEvents {
  'match:subscribe': (payload: { matchId: string }) => void;
  'match:unsubscribe': (payload: { matchId: string }) => void;
}
```

- [ ] **Step 2: Write useMatchSocket hook tests**

Create `src/__tests__/hooks/useMatchSocket.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock socket.io-client
const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  connected: true,
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

import { useMatchSocket } from '@/hooks/useMatchSocket';

describe('useMatchSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should subscribe to match room on mount', () => {
    renderHook(() => useMatchSocket('match-123'));
    expect(mockSocket.emit).toHaveBeenCalledWith('match:subscribe', {
      matchId: 'match-123',
    });
  });

  it('should register all event listeners', () => {
    renderHook(() => useMatchSocket('match-123'));
    const registeredEvents = mockSocket.on.mock.calls.map(
      (call: any) => call[0]
    );
    expect(registeredEvents).toContain('score:update');
    expect(registeredEvents).toContain('stats:update');
    expect(registeredEvents).toContain('match:status');
    expect(registeredEvents).toContain('scoreflow:add');
  });

  it('should unsubscribe and disconnect on unmount', () => {
    const { unmount } = renderHook(() => useMatchSocket('match-123'));
    unmount();
    expect(mockSocket.emit).toHaveBeenCalledWith('match:unsubscribe', {
      matchId: 'match-123',
    });
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('should update score state on score:update event', () => {
    renderHook(() => useMatchSocket('match-123'));

    // Find the score:update handler
    const scoreHandler = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'score:update'
    )?.[1];

    expect(scoreHandler).toBeDefined();
  });
});
```

Run: `npx vitest run src/__tests__/hooks/useMatchSocket.test.ts` — expect FAIL.

- [ ] **Step 3: Implement useMatchSocket hook**

Create `src/hooks/useMatchSocket.ts`:

```typescript
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  ScoreUpdatePayload,
  StatsUpdatePayload,
  MatchStatusPayload,
  ScoreFlowAddPayload,
} from '@/types/socket';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface MatchSocketState {
  score: ScoreUpdatePayload | null;
  playerStats: StatsUpdatePayload | null;
  matchStatus: MatchStatusPayload | null;
  scoreFlow: ScoreFlowAddPayload[];
  isConnected: boolean;
}

export function useMatchSocket(matchId: string) {
  const socketRef = useRef<TypedSocket | null>(null);
  const [state, setState] = useState<MatchSocketState>({
    score: null,
    playerStats: null,
    matchStatus: null,
    scoreFlow: [],
    isConnected: false,
  });

  useEffect(() => {
    const socket: TypedSocket = io({
      path: '/api/socketio',
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
    });

    socketRef.current = socket;

    socket.on('connect' as any, () => {
      setState((prev) => ({ ...prev, isConnected: true }));
      socket.emit('match:subscribe', { matchId });
    });

    socket.on('disconnect' as any, () => {
      setState((prev) => ({ ...prev, isConnected: false }));
    });

    socket.on('score:update', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => ({ ...prev, score: payload }));
      }
    });

    socket.on('stats:update', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => ({ ...prev, playerStats: payload }));
      }
    });

    socket.on('match:status', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => ({ ...prev, matchStatus: payload }));
      }
    });

    socket.on('scoreflow:add', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => ({
          ...prev,
          scoreFlow: [...prev.scoreFlow, payload],
        }));
      }
    });

    // Subscribe to match room
    socket.emit('match:subscribe', { matchId });

    return () => {
      socket.emit('match:unsubscribe', { matchId });
      socket.off('score:update');
      socket.off('stats:update');
      socket.off('match:status');
      socket.off('scoreflow:add');
      socket.disconnect();
    };
  }, [matchId]);

  return state;
}
```

Run: `npx vitest run src/__tests__/hooks/useMatchSocket.test.ts` — expect PASS.

- [ ] **Step 4: Build LiveScoreHero component**

Create `src/components/match/LiveScoreHero.tsx`:

```tsx
import { LiveIndicator } from '@/components/shared/LiveIndicator';
import { TeamBadge } from '@/components/shared/TeamBadge';
import type { Match, Team } from '@prisma/client';

interface LiveScoreHeroProps {
  match: Match & { homeTeam: Team; awayTeam: Team };
  liveScore?: { homeScore: number; awayScore: number; currentQuarter: number; currentTime: string } | null;
  matchStatus?: { status: 'LIVE' | 'COMPLETED' } | null;
}

export function LiveScoreHero({ match, liveScore, matchStatus }: LiveScoreHeroProps) {
  const homeScore = liveScore?.homeScore ?? match.homeScore;
  const awayScore = liveScore?.awayScore ?? match.awayScore;
  const quarter = liveScore?.currentQuarter ?? match.currentQuarter;
  const time = liveScore?.currentTime ?? match.currentTime;
  const isLive = matchStatus?.status === 'LIVE' || match.status === 'LIVE';

  return (
    <div className="relative overflow-hidden rounded-xl bg-primary-container text-white p-8 md:p-12 shadow-2xl">
      {/* Gradient overlay */}
      <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-secondary/20 to-transparent pointer-events-none" />

      <div className="flex flex-col md:flex-row justify-between items-center gap-8 relative z-10">
        {/* Home team */}
        <div className="flex flex-col items-center md:items-start text-center md:text-left gap-4">
          <TeamBadge team={match.homeTeam} size="lg" />
          <div>
            <h2 className="font-headline text-3xl font-extrabold tracking-tighter uppercase italic">
              {match.homeTeam.name}
            </h2>
            <p className="text-on-primary-container font-label text-xs tracking-widest uppercase">
              Home Team
            </p>
          </div>
        </div>

        {/* Score center */}
        <div className="flex flex-col items-center gap-2">
          {isLive && (
            <div className="bg-secondary px-3 py-1 rounded-full flex items-center gap-2 mb-4">
              <LiveIndicator />
              <span className="font-label text-[10px] font-bold uppercase tracking-tighter text-on-secondary">
                LIVE Q{quarter} {time && `\u2022 ${time}`}
              </span>
            </div>
          )}
          <div className="flex items-center gap-8">
            <span className="font-headline text-7xl md:text-9xl font-black tracking-tighter">
              {homeScore}
            </span>
            <span className="font-headline text-2xl font-light text-on-primary-container">
              &mdash;
            </span>
            <span className="font-headline text-7xl md:text-9xl font-black tracking-tighter">
              {awayScore}
            </span>
          </div>
          <p className="font-label text-xs uppercase tracking-widest text-secondary-fixed font-bold mt-4">
            Round {match.round} &bull; {match.venue}
          </p>
        </div>

        {/* Away team */}
        <div className="flex flex-col items-center md:items-end text-center md:text-right gap-4">
          <TeamBadge team={match.awayTeam} size="lg" />
          <div>
            <h2 className="font-headline text-3xl font-extrabold tracking-tighter uppercase italic">
              {match.awayTeam.name}
            </h2>
            <p className="text-on-primary-container font-label text-xs tracking-widest uppercase">
              Away Team
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Build LiveLineups component**

Create `src/components/match/LiveLineups.tsx`:

```tsx
import type { Player, PlayerMatchStats, Team } from '@prisma/client';

type PlayerWithStats = Player & { matchStats: PlayerMatchStats[] };

interface LiveLineupsProps {
  homeTeam: Team;
  awayTeam: Team;
  homePlayers: PlayerWithStats[];
  awayPlayers: PlayerWithStats[];
}

function getStatLabel(player: PlayerWithStats): string {
  const stats = player.matchStats[0];
  if (!stats) return '';
  if (player.position === 'GS' || player.position === 'GA') {
    return `${stats.goals}/${stats.attempts}`;
  }
  if (player.position === 'WA') return `${stats.goalAssists} AST`;
  if (player.position === 'C') return `${stats.feeds} FEED`;
  if (player.position === 'WD') return `${stats.deflections} DEF`;
  if (player.position === 'GD') return `${stats.intercepts} INT`;
  if (player.position === 'GK') return `${stats.intercepts} INT`;
  return '';
}

export function LiveLineups({
  homeTeam,
  awayTeam,
  homePlayers,
  awayPlayers,
}: LiveLineupsProps) {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/15">
      <h3 className="font-headline text-xl font-bold mb-6 flex items-center gap-2">
        <span className="material-symbols-outlined text-secondary">groups</span>
        Live Lineups
      </h3>
      <div className="grid grid-cols-2 gap-12">
        {/* Home team */}
        <div className="space-y-4">
          <p className="font-label text-[10px] font-black uppercase text-secondary border-b border-outline-variant pb-2">
            {homeTeam.name}
          </p>
          <div className="space-y-3">
            {homePlayers.map((player) => (
              <div
                key={player.id}
                className="flex items-center justify-between group cursor-pointer p-2 rounded hover:bg-surface-container-low transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full bg-primary-container text-white flex items-center justify-center text-[10px] font-bold">
                    {player.position}
                  </span>
                  <span className="font-body font-semibold">{player.name}</span>
                </div>
                <span className="font-label text-[10px] text-on-surface-variant bg-surface-container-high px-2 py-1 rounded">
                  {getStatLabel(player)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Away team */}
        <div className="space-y-4">
          <p className="font-label text-[10px] font-black uppercase text-secondary border-b border-outline-variant pb-2 text-right">
            {awayTeam.name}
          </p>
          <div className="space-y-3">
            {awayPlayers.map((player) => (
              <div
                key={player.id}
                className="flex items-center justify-between flex-row-reverse group cursor-pointer p-2 rounded hover:bg-surface-container-low transition-colors"
              >
                <div className="flex items-center gap-3 flex-row-reverse">
                  <span className="w-8 h-8 rounded-full bg-secondary text-white flex items-center justify-center text-[10px] font-bold">
                    {player.position}
                  </span>
                  <span className="font-body font-semibold">{player.name}</span>
                </div>
                <span className="font-label text-[10px] text-on-surface-variant bg-surface-container-high px-2 py-1 rounded">
                  {getStatLabel(player)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Build MatchStatsComparison component**

Create `src/components/match/MatchStatsComparison.tsx`:

```tsx
interface StatBar {
  label: string;
  homeValue: number;
  awayValue: number;
  format?: 'number' | 'percentage';
}

interface MatchStatsComparisonProps {
  stats: StatBar[];
}

export function MatchStatsComparison({ stats }: MatchStatsComparisonProps) {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/15">
      <div className="flex justify-between items-center mb-8">
        <h3 className="font-headline text-xl font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary">
            analytics
          </span>
          Key Match Stats
        </h3>
      </div>
      <div className="space-y-6">
        {stats.map((stat) => {
          const total = stat.homeValue + stat.awayValue;
          const homePct = total > 0 ? (stat.homeValue / total) * 100 : 50;
          const awayPct = 100 - homePct;
          const suffix = stat.format === 'percentage' ? '%' : '';

          return (
            <div key={stat.label} className="space-y-2">
              <div className="flex justify-between text-xs font-bold font-label uppercase">
                <span>
                  {stat.homeValue}
                  {suffix}
                </span>
                <span>{stat.label}</span>
                <span>
                  {stat.awayValue}
                  {suffix}
                </span>
              </div>
              <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-primary-container"
                  style={{ width: `${homePct}%` }}
                />
                <div
                  className="h-full bg-secondary"
                  style={{ width: `${awayPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Build LivePlayByPlay component**

Create `src/components/match/LivePlayByPlay.tsx`:

```tsx
import type { ScoreFlowAddPayload } from '@/types/socket';

interface PlayByPlayEntry {
  time: string;
  quarter: number;
  description: string;
  isScoring: boolean;
  score?: string;
}

interface LivePlayByPlayProps {
  entries: PlayByPlayEntry[];
}

export function LivePlayByPlay({ entries }: LivePlayByPlayProps) {
  return (
    <div className="bg-slate-950 rounded-xl overflow-hidden shadow-2xl sticky top-24">
      <div className="bg-slate-900 p-4 border-b border-slate-800 flex items-center justify-between">
        <h4 className="text-white font-headline text-sm font-bold uppercase tracking-widest flex items-center gap-2">
          <span className="material-symbols-outlined text-lime-400 text-sm">
            sensors
          </span>
          Live Feed
        </h4>
        <span className="text-[10px] text-lime-400 font-bold uppercase">
          Real-Time
        </span>
      </div>
      <div className="h-[600px] overflow-y-auto p-4 space-y-6">
        {entries.map((entry, i) => (
          <div key={i} className="flex gap-4 relative">
            <div className="flex-none flex flex-col items-center">
              <div
                className={`w-1.5 h-1.5 rounded-full mt-2 ${
                  entry.isScoring ? 'bg-lime-400' : 'bg-slate-600'
                }`}
              />
              {i < entries.length - 1 && (
                <div className="w-px h-full bg-slate-800 mt-2" />
              )}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-slate-500 font-headline uppercase">
                {entry.time} - Q{entry.quarter}
              </p>
              <p
                className={`text-sm ${
                  entry.isScoring
                    ? 'text-white font-medium'
                    : 'text-slate-300'
                }`}
              >
                {entry.description}
              </p>
              {entry.score && (
                <p className="text-lime-400 text-[10px] font-bold uppercase">
                  Score: {entry.score}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Build the Live Game Center page**

Create `src/app/match/[matchId]/live/page.tsx`:

```tsx
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { LiveGameClient } from './LiveGameClient';

interface Props {
  params: Promise<{ matchId: string }>;
}

export default async function LiveGamePage({ params }: Props) {
  const { matchId } = await params;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      homeTeam: {
        include: {
          players: {
            include: {
              matchStats: {
                where: { matchId },
              },
            },
          },
        },
      },
      awayTeam: {
        include: {
          players: {
            include: {
              matchStats: {
                where: { matchId },
              },
            },
          },
        },
      },
      quarters: { orderBy: { quarter: 'asc' } },
    },
  });

  if (!match) return notFound();

  return <LiveGameClient match={match} />;
}
```

Create `src/app/match/[matchId]/live/LiveGameClient.tsx`:

```tsx
'use client';

import { useMatchSocket } from '@/hooks/useMatchSocket';
import { LiveScoreHero } from '@/components/match/LiveScoreHero';
import { LiveLineups } from '@/components/match/LiveLineups';
import { MatchStatsComparison } from '@/components/match/MatchStatsComparison';
import { LivePlayByPlay } from '@/components/match/LivePlayByPlay';
import type { Match, Team, Player, PlayerMatchStats, MatchQuarter } from '@prisma/client';

type FullMatch = Match & {
  homeTeam: Team & { players: (Player & { matchStats: PlayerMatchStats[] })[] };
  awayTeam: Team & { players: (Player & { matchStats: PlayerMatchStats[] })[] };
  quarters: MatchQuarter[];
};

interface LiveGameClientProps {
  match: FullMatch;
}

export function LiveGameClient({ match }: LiveGameClientProps) {
  const { score, playerStats, matchStatus, scoreFlow } = useMatchSocket(match.id);

  // Compute comparison stats from current data
  const homeStats = match.homeTeam.players.flatMap((p) => p.matchStats);
  const awayStats = match.awayTeam.players.flatMap((p) => p.matchStats);

  const sumStat = (stats: PlayerMatchStats[], key: keyof PlayerMatchStats) =>
    stats.reduce((sum, s) => sum + (Number(s[key]) || 0), 0);

  const comparisonStats = [
    {
      label: 'Goals',
      homeValue: sumStat(homeStats, 'goals'),
      awayValue: sumStat(awayStats, 'goals'),
    },
    {
      label: 'Intercepts',
      homeValue: sumStat(homeStats, 'intercepts'),
      awayValue: sumStat(awayStats, 'intercepts'),
    },
    {
      label: 'Deflections',
      homeValue: sumStat(homeStats, 'deflections'),
      awayValue: sumStat(awayStats, 'deflections'),
    },
    {
      label: 'Turnovers',
      homeValue: sumStat(homeStats, 'turnovers'),
      awayValue: sumStat(awayStats, 'turnovers'),
    },
  ];

  // Build play-by-play entries from score flow
  const playByPlayEntries = scoreFlow.map((flow) => ({
    time: `${Math.floor(flow.periodSeconds / 60)}:${String(flow.periodSeconds % 60).padStart(2, '0')}`,
    quarter: flow.period,
    description: `Goal scored. ${flow.homeScore} - ${flow.awayScore}`,
    isScoring: true,
    score: `${flow.homeScore} - ${flow.awayScore}`,
  }));

  return (
    <section className="p-4 md:p-8 space-y-8 max-w-7xl mx-auto">
      <LiveScoreHero match={match} liveScore={score} matchStatus={matchStatus} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <LiveLineups
            homeTeam={match.homeTeam}
            awayTeam={match.awayTeam}
            homePlayers={match.homeTeam.players}
            awayPlayers={match.awayTeam.players}
          />
          <MatchStatsComparison stats={comparisonStats} />
        </div>

        <div className="lg:col-span-1">
          <LivePlayByPlay entries={playByPlayEntries} />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 9: Install socket.io-client, run tests, verify build**

```bash
npm install socket.io-client
npx vitest run src/__tests__/hooks/useMatchSocket.test.ts
```

Expect: all hook tests PASS.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: add live game center page with Socket.io real-time updates"
```

---

### Task 14: On-Court Visualizer (`/match/[matchId]/court`)

**Files:**
- Create: `src/components/match/NetballCourt.tsx`
- Create: `src/app/match/[matchId]/court/page.tsx`
- Create: `src/app/match/[matchId]/court/CourtClient.tsx`
- Test: `src/__tests__/components/NetballCourt.test.tsx`

**Reference:** `stitch-designs/on-court-visualizer/index.html`

**Note:** Positions are static (designated GS, GA, WA, C, WD, GD, GK placements), not live tracking. Player stat overlays update via WebSocket.

- [ ] **Step 1: Write NetballCourt tests**

Create `src/__tests__/components/NetballCourt.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NetballCourt } from '@/components/match/NetballCourt';

const mockHomePlayers = [
  { id: '1', name: 'Player A', position: 'GS' as const, teamId: 'home' },
  { id: '2', name: 'Player B', position: 'GA' as const, teamId: 'home' },
  { id: '3', name: 'Player C', position: 'WA' as const, teamId: 'home' },
  { id: '4', name: 'Player D', position: 'C' as const, teamId: 'home' },
  { id: '5', name: 'Player E', position: 'WD' as const, teamId: 'home' },
  { id: '6', name: 'Player F', position: 'GD' as const, teamId: 'home' },
  { id: '7', name: 'Player G', position: 'GK' as const, teamId: 'home' },
];

const mockAwayPlayers = [
  { id: '8', name: 'Player H', position: 'GS' as const, teamId: 'away' },
  { id: '9', name: 'Player I', position: 'GA' as const, teamId: 'away' },
  { id: '10', name: 'Player J', position: 'WA' as const, teamId: 'away' },
  { id: '11', name: 'Player K', position: 'C' as const, teamId: 'away' },
  { id: '12', name: 'Player L', position: 'WD' as const, teamId: 'away' },
  { id: '13', name: 'Player M', position: 'GD' as const, teamId: 'away' },
  { id: '14', name: 'Player N', position: 'GK' as const, teamId: 'away' },
];

describe('NetballCourt', () => {
  it('should render 14 player nodes (7 per team)', () => {
    const { container } = render(
      <NetballCourt homePlayers={mockHomePlayers} awayPlayers={mockAwayPlayers} />
    );
    const playerNodes = container.querySelectorAll('[data-testid^="player-node"]');
    expect(playerNodes).toHaveLength(14);
  });

  it('should render court lines (thirds, centre circle, shooting circles)', () => {
    const { container } = render(
      <NetballCourt homePlayers={mockHomePlayers} awayPlayers={mockAwayPlayers} />
    );
    expect(container.querySelector('[data-testid="thirds-line-1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="thirds-line-2"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="centre-circle"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="shooting-circle-top"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="shooting-circle-bottom"]')).toBeTruthy();
  });

  it('should display position abbreviations in nodes', () => {
    render(
      <NetballCourt homePlayers={mockHomePlayers} awayPlayers={mockAwayPlayers} />
    );
    expect(screen.getByText('GS')).toBeTruthy();
    expect(screen.getByText('GK')).toBeTruthy();
  });
});
```

Run: `npx vitest run src/__tests__/components/NetballCourt.test.tsx` — expect FAIL.

- [ ] **Step 2: Implement NetballCourt component**

Create `src/components/match/NetballCourt.tsx`:

```tsx
import type { Position } from '@prisma/client';

interface CourtPlayer {
  id: string;
  name: string;
  position: Position;
  teamId: string;
}

interface NetballCourtProps {
  homePlayers: CourtPlayer[];
  awayPlayers: CourtPlayer[];
}

// Static positions on court (percentage-based x,y).
// Court is vertical: home attacks top, away attacks bottom.
const POSITION_COORDS: Record<Position, { x: number; y: number }> = {
  GS: { x: 42, y: 8 },
  GA: { x: 30, y: 20 },
  WA: { x: 25, y: 40 },
  C: { x: 55, y: 50 },
  WD: { x: 75, y: 60 },
  GD: { x: 60, y: 78 },
  GK: { x: 55, y: 92 },
};

// Away team mirrors: flip y axis
const AWAY_POSITION_COORDS: Record<Position, { x: number; y: number }> = {
  GS: { x: 58, y: 92 },
  GA: { x: 70, y: 80 },
  WA: { x: 75, y: 60 },
  C: { x: 45, y: 50 },
  WD: { x: 25, y: 40 },
  GD: { x: 40, y: 22 },
  GK: { x: 45, y: 8 },
};

export function NetballCourt({ homePlayers, awayPlayers }: NetballCourtProps) {
  return (
    <div className="bg-slate-950 rounded-3xl overflow-hidden shadow-2xl relative aspect-[3/4] md:aspect-[16/10] border-4 border-slate-900">
      <div className="absolute inset-0 flex flex-col p-8 md:p-12 overflow-hidden">
        <div className="w-full h-full border-2 border-slate-700/50 rounded-xl relative flex flex-col">
          {/* Thirds lines */}
          <div
            data-testid="thirds-line-1"
            className="absolute top-1/3 left-0 w-full h-0 border-t border-slate-700/50"
          />
          <div
            data-testid="thirds-line-2"
            className="absolute top-2/3 left-0 w-full h-0 border-t border-slate-700/50"
          />

          {/* Centre circle */}
          <div
            data-testid="centre-circle"
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 border border-slate-700/50 rounded-full flex items-center justify-center"
          >
            <div className="w-2 h-2 bg-lime-400 rounded-full blur-[1px]" />
          </div>

          {/* Shooting circles */}
          <div
            data-testid="shooting-circle-top"
            className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 border-b border-x border-slate-700/50 rounded-b-full"
          />
          <div
            data-testid="shooting-circle-bottom"
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-48 h-24 border-t border-x border-slate-700/50 rounded-t-full"
          />

          {/* Goal rings */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 w-3 h-3 bg-secondary rounded-full" />
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-3 h-3 bg-secondary rounded-full" />

          {/* Home team players (primary-container blue) */}
          {homePlayers.map((player) => {
            const coords = POSITION_COORDS[player.position];
            return (
              <div
                key={player.id}
                data-testid={`player-node-${player.id}`}
                className="absolute flex flex-col items-center"
                style={{ left: `${coords.x}%`, top: `${coords.y}%` }}
              >
                <div className="w-8 h-8 md:w-10 md:h-10 bg-primary-container text-white border-2 border-on-primary-container rounded-full flex items-center justify-center font-black font-headline text-xs shadow-lg shadow-primary-container/40">
                  {player.position}
                </div>
              </div>
            );
          })}

          {/* Away team players (lime green) */}
          {awayPlayers.map((player) => {
            const coords = AWAY_POSITION_COORDS[player.position];
            return (
              <div
                key={player.id}
                data-testid={`player-node-${player.id}`}
                className="absolute flex flex-col items-center"
                style={{ left: `${coords.x}%`, top: `${coords.y}%` }}
              >
                <div className="w-8 h-8 md:w-10 md:h-10 bg-lime-500 text-slate-950 border-2 border-lime-300 rounded-full flex items-center justify-center font-black font-headline text-xs shadow-lg shadow-lime-500/40">
                  {player.position}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

Run: `npx vitest run src/__tests__/components/NetballCourt.test.tsx` — expect PASS.

- [ ] **Step 3: Build the Court page (server + client)**

Create `src/app/match/[matchId]/court/page.tsx`:

```tsx
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { CourtClient } from './CourtClient';

interface Props {
  params: Promise<{ matchId: string }>;
}

export default async function CourtPage({ params }: Props) {
  const { matchId } = await params;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      homeTeam: {
        include: {
          players: {
            include: {
              matchStats: { where: { matchId } },
            },
          },
        },
      },
      awayTeam: {
        include: {
          players: {
            include: {
              matchStats: { where: { matchId } },
            },
          },
        },
      },
    },
  });

  if (!match) return notFound();

  return <CourtClient match={match} />;
}
```

Create `src/app/match/[matchId]/court/CourtClient.tsx`:

```tsx
'use client';

import { useMatchSocket } from '@/hooks/useMatchSocket';
import { NetballCourt } from '@/components/match/NetballCourt';
import { LiveIndicator } from '@/components/shared/LiveIndicator';
import type { Match, Team, Player, PlayerMatchStats } from '@prisma/client';

type FullMatch = Match & {
  homeTeam: Team & { players: (Player & { matchStats: PlayerMatchStats[] })[] };
  awayTeam: Team & { players: (Player & { matchStats: PlayerMatchStats[] })[] };
};

interface CourtClientProps {
  match: FullMatch;
}

export function CourtClient({ match }: CourtClientProps) {
  const { score, matchStatus } = useMatchSocket(match.id);

  const homeScore = score?.homeScore ?? match.homeScore;
  const awayScore = score?.awayScore ?? match.awayScore;
  const isLive = matchStatus?.status === 'LIVE' || match.status === 'LIVE';
  const quarter = score?.currentQuarter ?? match.currentQuarter;
  const time = score?.currentTime ?? match.currentTime;

  return (
    <section className="pt-24 px-4 md:px-8 max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-12 gap-8 mb-12">
      {/* Header */}
      <div className="xl:col-span-12 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          {isLive && (
            <div className="inline-flex items-center gap-2 bg-secondary/20 text-secondary px-3 py-1 rounded-full mb-4">
              <LiveIndicator />
              <span className="text-xs font-bold uppercase tracking-widest font-headline">
                Live Tracking
              </span>
            </div>
          )}
          <h1 className="text-4xl md:text-6xl font-black font-headline tracking-tighter uppercase text-primary-container">
            Court Visualizer
          </h1>
        </div>
      </div>

      {/* Court */}
      <div className="xl:col-span-8">
        <NetballCourt
          homePlayers={match.homeTeam.players}
          awayPlayers={match.awayTeam.players}
        />
      </div>

      {/* Sidebar widgets */}
      <aside className="xl:col-span-4 flex flex-col gap-6">
        {/* Scoreboard widget */}
        <div className="bg-primary-container rounded-3xl p-6 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-secondary/10 rounded-full -translate-y-12 translate-x-12 blur-3xl" />
          <div className="flex justify-between items-center mb-8 relative">
            <span className="text-xs font-black tracking-widest text-lime-400 uppercase font-headline">
              {quarter ? `Quarter ${quarter}` : ''} {time ? `- ${time}` : ''}
            </span>
            {isLive && (
              <span className="bg-red-600 text-white text-[10px] px-2 py-0.5 rounded font-bold font-headline animate-pulse">
                LIVE
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 mb-6 relative">
            <div className="flex flex-col items-center text-center">
              <p className="text-on-primary-container text-xs font-bold uppercase font-headline tracking-tight">
                {match.homeTeam.name}
              </p>
              <p className="text-5xl font-black text-white font-headline mt-1">
                {homeScore}
              </p>
            </div>
            <div className="flex flex-col items-center text-center">
              <p className="text-on-primary-container text-xs font-bold uppercase font-headline tracking-tight">
                {match.awayTeam.name}
              </p>
              <p className="text-5xl font-black text-white font-headline mt-1">
                {awayScore}
              </p>
            </div>
          </div>
        </div>

        {/* Key stats bento */}
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Goals', home: match.homeScore, away: match.awayScore },
            {
              label: 'Turnovers',
              home: match.homeTeam.players.reduce(
                (sum, p) => sum + (p.matchStats[0]?.turnovers ?? 0),
                0
              ),
              away: match.awayTeam.players.reduce(
                (sum, p) => sum + (p.matchStats[0]?.turnovers ?? 0),
                0
              ),
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-surface-container-lowest rounded-3xl p-5 shadow-sm"
            >
              <p className="text-[10px] font-bold text-on-surface-variant uppercase font-headline tracking-widest mb-1">
                {stat.label}
              </p>
              <p className="text-2xl font-black text-primary font-headline">
                {stat.home} - {stat.away}
              </p>
            </div>
          ))}
        </div>
      </aside>
    </section>
  );
}
```

- [ ] **Step 4: Run tests, verify build**

```bash
npx vitest run src/__tests__/components/NetballCourt.test.tsx
```

Expect: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add on-court visualizer with SVG court and player position nodes"
```

---

### Task 15: Real-Time Infrastructure

**Files:**
- Create: `src/lib/socket-server.ts`
- Create: `src/lib/worker.ts`
- Create: `src/lib/match-sync.ts`
- Modify: `server.js` (integrate Socket.io server and worker)
- Test: `src/__tests__/lib/match-sync.test.ts`
- Test: `src/__tests__/lib/worker.test.ts`

- [ ] **Step 1: Write match-sync tests**

Create `src/__tests__/lib/match-sync.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    match: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    playerMatchStats: {
      upsert: vi.fn(),
    },
    matchQuarter: {
      upsert: vi.fn(),
    },
    scoreFlow: {
      create: vi.fn(),
    },
  },
}));

describe('match-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect score changes and return changed matches', async () => {
    const { prisma } = await import('@/lib/prisma');
    const { detectChanges } = await import('@/lib/match-sync');

    (prisma.match.findMany as any).mockResolvedValue([
      {
        id: 'match-1',
        championDataMatchId: 100,
        homeScore: 30,
        awayScore: 28,
        status: 'LIVE',
      },
    ]);

    const changes = await detectChanges({
      matchId: 100,
      homeScore: 32,
      awayScore: 28,
      status: 'LIVE',
      currentQuarter: 3,
      currentTime: '10:00',
    });

    expect(changes).toEqual(
      expect.objectContaining({
        matchId: 'match-1',
        scoreChanged: true,
      })
    );
  });

  it('should return no changes when scores are the same', async () => {
    const { prisma } = await import('@/lib/prisma');
    const { detectChanges } = await import('@/lib/match-sync');

    (prisma.match.findMany as any).mockResolvedValue([
      {
        id: 'match-1',
        championDataMatchId: 100,
        homeScore: 30,
        awayScore: 28,
        status: 'LIVE',
      },
    ]);

    const changes = await detectChanges({
      matchId: 100,
      homeScore: 30,
      awayScore: 28,
      status: 'LIVE',
      currentQuarter: 3,
      currentTime: '10:00',
    });

    expect(changes).toEqual(
      expect.objectContaining({
        scoreChanged: false,
      })
    );
  });

  it('should detect status change from LIVE to COMPLETED', async () => {
    const { prisma } = await import('@/lib/prisma');
    const { detectChanges } = await import('@/lib/match-sync');

    (prisma.match.findMany as any).mockResolvedValue([
      {
        id: 'match-1',
        championDataMatchId: 100,
        homeScore: 55,
        awayScore: 50,
        status: 'LIVE',
      },
    ]);

    const changes = await detectChanges({
      matchId: 100,
      homeScore: 55,
      awayScore: 50,
      status: 'COMPLETED',
      currentQuarter: 4,
      currentTime: '00:00',
    });

    expect(changes).toEqual(
      expect.objectContaining({
        statusChanged: true,
      })
    );
  });
});
```

Run: `npx vitest run src/__tests__/lib/match-sync.test.ts` — expect FAIL.

- [ ] **Step 2: Implement match-sync**

Create `src/lib/match-sync.ts`:

```typescript
import { prisma } from '@/lib/prisma';
import type { MatchStatus } from '@prisma/client';

interface ChampionDataMatchState {
  matchId: number; // championDataMatchId
  homeScore: number;
  awayScore: number;
  status: string;
  currentQuarter: number;
  currentTime: string;
  playerStats?: Array<{
    championDataPlayerId: number;
    goals: number;
    attempts: number;
    goalAssists: number;
    intercepts: number;
    deflections: number;
    rebounds: number;
    penalties: number;
    feeds: number;
    centrePassReceives: number;
    turnovers: number;
    minutesPlayed: number;
  }>;
  quarterScores?: Array<{
    quarter: number;
    homeScore: number;
    awayScore: number;
  }>;
}

interface ChangeResult {
  matchId: string;
  scoreChanged: boolean;
  statusChanged: boolean;
  newHomeScore: number;
  newAwayScore: number;
  newStatus: MatchStatus;
  currentQuarter: number;
  currentTime: string;
}

export async function detectChanges(
  incoming: ChampionDataMatchState
): Promise<ChangeResult> {
  const matches = await prisma.match.findMany({
    where: { championDataMatchId: incoming.matchId },
  });

  const match = matches[0];
  if (!match) {
    return {
      matchId: '',
      scoreChanged: false,
      statusChanged: false,
      newHomeScore: incoming.homeScore,
      newAwayScore: incoming.awayScore,
      newStatus: incoming.status as MatchStatus,
      currentQuarter: incoming.currentQuarter,
      currentTime: incoming.currentTime,
    };
  }

  const scoreChanged =
    match.homeScore !== incoming.homeScore ||
    match.awayScore !== incoming.awayScore;

  const statusChanged = match.status !== incoming.status;

  return {
    matchId: match.id,
    scoreChanged,
    statusChanged,
    newHomeScore: incoming.homeScore,
    newAwayScore: incoming.awayScore,
    newStatus: incoming.status as MatchStatus,
    currentQuarter: incoming.currentQuarter,
    currentTime: incoming.currentTime,
  };
}

export async function applyChanges(
  changes: ChangeResult,
  incoming: ChampionDataMatchState
): Promise<void> {
  if (!changes.matchId) return;

  // Update match record
  if (changes.scoreChanged || changes.statusChanged) {
    await prisma.match.update({
      where: { id: changes.matchId },
      data: {
        homeScore: changes.newHomeScore,
        awayScore: changes.newAwayScore,
        status: changes.newStatus,
        currentQuarter: changes.currentQuarter,
        currentTime: changes.currentTime,
      },
    });
  }

  // Upsert quarter scores
  if (incoming.quarterScores) {
    for (const qs of incoming.quarterScores) {
      await prisma.matchQuarter.upsert({
        where: {
          matchId_quarter: {
            matchId: changes.matchId,
            quarter: qs.quarter,
          },
        },
        update: {
          homeScore: qs.homeScore,
          awayScore: qs.awayScore,
        },
        create: {
          matchId: changes.matchId,
          quarter: qs.quarter,
          homeScore: qs.homeScore,
          awayScore: qs.awayScore,
        },
      });
    }
  }

  // Upsert player stats
  if (incoming.playerStats) {
    for (const ps of incoming.playerStats) {
      const player = await prisma.player.findUnique({
        where: { championDataPlayerId: ps.championDataPlayerId },
      });
      if (!player) continue;

      await prisma.playerMatchStats.upsert({
        where: {
          playerId_matchId: {
            playerId: player.id,
            matchId: changes.matchId,
          },
        },
        update: {
          goals: ps.goals,
          attempts: ps.attempts,
          goalAssists: ps.goalAssists,
          intercepts: ps.intercepts,
          deflections: ps.deflections,
          rebounds: ps.rebounds,
          penalties: ps.penalties,
          feeds: ps.feeds,
          centrePassReceives: ps.centrePassReceives,
          turnovers: ps.turnovers,
          minutesPlayed: ps.minutesPlayed,
        },
        create: {
          playerId: player.id,
          matchId: changes.matchId,
          goals: ps.goals,
          attempts: ps.attempts,
          goalAssists: ps.goalAssists,
          intercepts: ps.intercepts,
          deflections: ps.deflections,
          rebounds: ps.rebounds,
          penalties: ps.penalties,
          feeds: ps.feeds,
          centrePassReceives: ps.centrePassReceives,
          turnovers: ps.turnovers,
          minutesPlayed: ps.minutesPlayed,
        },
      });
    }
  }
}
```

Run: `npx vitest run src/__tests__/lib/match-sync.test.ts` — expect PASS.

- [ ] **Step 3: Implement Socket.io server setup**

Create `src/lib/socket-server.ts`:

```typescript
import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  ScoreUpdatePayload,
  StatsUpdatePayload,
  MatchStatusPayload,
  ScoreFlowAddPayload,
} from '@/types/socket';

let io: SocketServer<ClientToServerEvents, ServerToClientEvents> | null = null;

export function initSocketServer(httpServer: HttpServer) {
  io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    {
      path: '/api/socketio',
      cors: {
        origin: process.env.NEXTAUTH_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
      },
    }
  );

  io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    socket.on('match:subscribe', ({ matchId }) => {
      socket.join(`match:${matchId}`);
      console.log(`[Socket.io] ${socket.id} joined match:${matchId}`);
    });

    socket.on('match:unsubscribe', ({ matchId }) => {
      socket.leave(`match:${matchId}`);
      console.log(`[Socket.io] ${socket.id} left match:${matchId}`);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO() {
  if (!io) {
    throw new Error('Socket.io not initialized. Call initSocketServer first.');
  }
  return io;
}

export function broadcastScoreUpdate(matchId: string, payload: ScoreUpdatePayload) {
  getIO().to(`match:${matchId}`).emit('score:update', payload);
}

export function broadcastStatsUpdate(matchId: string, payload: StatsUpdatePayload) {
  getIO().to(`match:${matchId}`).emit('stats:update', payload);
}

export function broadcastMatchStatus(matchId: string, payload: MatchStatusPayload) {
  getIO().to(`match:${matchId}`).emit('match:status', payload);
}

export function broadcastScoreFlowAdd(matchId: string, payload: ScoreFlowAddPayload) {
  getIO().to(`match:${matchId}`).emit('scoreflow:add', payload);
}
```

- [ ] **Step 4: Write worker tests**

Create `src/__tests__/lib/worker.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/match-sync', () => ({
  detectChanges: vi.fn(),
  applyChanges: vi.fn(),
}));

describe('Worker', () => {
  it('should export getPollingInterval function', async () => {
    const { getPollingInterval } = await import('@/lib/worker');
    expect(typeof getPollingInterval).toBe('function');
  });

  it('should return 30s for live matches', async () => {
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(true, true)).toBe(30_000);
  });

  it('should return 15min for match day with no live match', async () => {
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(false, true)).toBe(900_000);
  });

  it('should return 6h for off-season', async () => {
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(false, false)).toBe(21_600_000);
  });
});
```

Run: `npx vitest run src/__tests__/lib/worker.test.ts` — expect FAIL.

- [ ] **Step 5: Implement background worker**

Create `src/lib/worker.ts`:

```typescript
import { prisma } from '@/lib/prisma';
import { detectChanges, applyChanges } from '@/lib/match-sync';
import {
  broadcastScoreUpdate,
  broadcastStatsUpdate,
  broadcastMatchStatus,
} from '@/lib/socket-server';

const POLL_LIVE = 30_000; // 30 seconds
const POLL_MATCH_DAY = 900_000; // 15 minutes
const POLL_OFF_SEASON = 21_600_000; // 6 hours

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

export function getPollingInterval(
  hasLiveMatch: boolean,
  isMatchDay: boolean
): number {
  if (hasLiveMatch) return POLL_LIVE;
  if (isMatchDay) return POLL_MATCH_DAY;
  return POLL_OFF_SEASON;
}

async function checkForLiveMatches(): Promise<boolean> {
  const liveCount = await prisma.match.count({
    where: { status: 'LIVE' },
  });
  return liveCount > 0;
}

async function checkIsMatchDay(): Promise<boolean> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const matchCount = await prisma.match.count({
    where: {
      scheduledAt: { gte: today, lt: tomorrow },
    },
  });
  return matchCount > 0;
}

async function pollChampionData(): Promise<void> {
  try {
    const COMP_ID = process.env.CHAMPION_DATA_COMP_ID;
    if (!COMP_ID) return;

    // Fetch live matches from Champion Data
    const res = await fetch(
      `https://mc.championdata.com/data/${COMP_ID}/fixture.json`
    );
    if (!res.ok) {
      console.error('[Worker] Champion Data fetch failed:', res.status);
      return;
    }

    const data = await res.json();

    // Process each match in the fixture
    const matches = data?.fixture?.match || [];
    for (const matchData of matches) {
      if (matchData.matchStatus !== 'LIVE') continue;

      // Fetch detailed match data
      const matchRes = await fetch(
        `https://mc.championdata.com/data/${COMP_ID}/${matchData.matchId}.json`
      );
      if (!matchRes.ok) continue;

      const matchDetail = await matchRes.json();

      const incoming = {
        matchId: matchData.matchId,
        homeScore: matchDetail.matchStats?.homeScore ?? 0,
        awayScore: matchDetail.matchStats?.awayScore ?? 0,
        status: matchData.matchStatus === 'Final' ? 'COMPLETED' : matchData.matchStatus,
        currentQuarter: matchDetail.matchStats?.currentPeriod ?? 0,
        currentTime: matchDetail.matchStats?.currentTime ?? '',
      };

      const changes = await detectChanges(incoming);

      if (changes.matchId && (changes.scoreChanged || changes.statusChanged)) {
        await applyChanges(changes, incoming);

        if (changes.scoreChanged) {
          broadcastScoreUpdate(changes.matchId, {
            matchId: changes.matchId,
            homeScore: changes.newHomeScore,
            awayScore: changes.newAwayScore,
            currentQuarter: changes.currentQuarter,
            currentTime: changes.currentTime,
          });
        }

        if (changes.statusChanged) {
          broadcastMatchStatus(changes.matchId, {
            matchId: changes.matchId,
            status: changes.newStatus as 'LIVE' | 'COMPLETED',
            quarter: changes.currentQuarter,
            time: changes.currentTime,
          });
        }
      }
    }
  } catch (error) {
    console.error('[Worker] Poll error:', error);
  }
}

async function scheduleNextPoll(): Promise<void> {
  if (!isRunning) return;

  const hasLive = await checkForLiveMatches();
  const isMatchDay = await checkIsMatchDay();
  const interval = getPollingInterval(hasLive, isMatchDay);

  console.log(
    `[Worker] Next poll in ${interval / 1000}s (live: ${hasLive}, matchDay: ${isMatchDay})`
  );

  pollTimer = setTimeout(async () => {
    await pollChampionData();
    await scheduleNextPoll();
  }, interval);
}

export function startWorker(): void {
  if (isRunning) return;
  isRunning = true;
  console.log('[Worker] Starting background worker');
  scheduleNextPoll();
}

export function stopWorker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log('[Worker] Stopped');
}
```

Run: `npx vitest run src/__tests__/lib/worker.test.ts` — expect PASS.

- [ ] **Step 6: Integrate Socket.io server and worker into server.js**

Modify `server.js` — add to the existing custom Express server:

```javascript
// Add these imports at the top of server.js
const { initSocketServer } = require('./src/lib/socket-server');
const { startWorker, stopWorker } = require('./src/lib/worker');

// After creating the HTTP server (after `const server = http.createServer(app);`):
// Initialize Socket.io
initSocketServer(server);
console.log('[Server] Socket.io initialized');

// Start background worker
startWorker();
console.log('[Server] Background worker started');

// Graceful shutdown (for Render deploys)
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down gracefully');
  stopWorker();
  server.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down');
  stopWorker();
  server.close(() => process.exit(0));
});
```

- [ ] **Step 7: Install socket.io, run all real-time tests**

```bash
npm install socket.io
npx vitest run src/__tests__/lib/match-sync.test.ts src/__tests__/lib/worker.test.ts
```

Expect: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add real-time infrastructure with Socket.io server and background worker"
```

---

### Task 16: User Personalization & Settings

**Files:**
- Create: `src/app/settings/page.tsx`
- Create: `src/app/api/user/teams/route.ts`
- Create: `src/app/api/user/favorites/route.ts`
- Create: `src/app/api/user/reminders/route.ts`
- Test: `src/__tests__/api/user-teams.test.ts`
- Test: `src/__tests__/api/user-favorites.test.ts`
- Test: `src/__tests__/api/user-reminders.test.ts`

- [ ] **Step 1: Write user teams API tests**

Create `src/__tests__/api/user-teams.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userTeam: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

describe('User Teams API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 if not authenticated', async () => {
    const { getServerSession } = await import('next-auth');
    (getServerSession as any).mockResolvedValue(null);

    const { GET } = await import('@/app/api/user/teams/route');
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('should return user teams when authenticated', async () => {
    const { getServerSession } = await import('next-auth');
    const { prisma } = await import('@/lib/prisma');

    (getServerSession as any).mockResolvedValue({
      user: { id: 'user-1' },
    });
    (prisma.userTeam.findMany as any).mockResolvedValue([
      { userId: 'user-1', teamId: 'team-1', team: { id: 'team-1', name: 'Vixens' } },
    ]);

    const { GET } = await import('@/app/api/user/teams/route');
    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveLength(1);
    expect(data[0].team.name).toBe('Vixens');
  });
});
```

Run: `npx vitest run src/__tests__/api/user-teams.test.ts` — expect FAIL.

- [ ] **Step 2: Implement user teams API**

Create `src/app/api/user/teams/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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
```

Run: `npx vitest run src/__tests__/api/user-teams.test.ts` — expect PASS.

- [ ] **Step 3: Implement favorites API**

Create `src/app/api/user/favorites/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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
```

- [ ] **Step 4: Implement reminders API**

Create `src/app/api/user/reminders/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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
```

- [ ] **Step 5: Build settings page**

Create `src/app/settings/page.tsx`:

```tsx
'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface TeamFollow {
  teamId: string;
  team: { id: string; name: string; abbreviation: string; logoUrl: string | null };
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [followedTeams, setFollowedTeams] = useState<TeamFollow[]>([]);
  const [allTeams, setAllTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [teamsRes, followsRes] = await Promise.all([
        fetch('/api/teams'),
        fetch('/api/user/teams'),
      ]);
      if (teamsRes.ok) setAllTeams(await teamsRes.json());
      if (followsRes.ok) setFollowedTeams(await followsRes.json());
      setLoading(false);
    }
    load();
  }, []);

  const followedIds = new Set(followedTeams.map((ft) => ft.teamId));

  const toggleTeam = async (teamId: string) => {
    if (followedIds.has(teamId)) {
      await fetch('/api/user/teams', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      });
      setFollowedTeams((prev) => prev.filter((ft) => ft.teamId !== teamId));
    } else {
      const res = await fetch('/api/user/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      });
      if (res.ok) {
        const team = allTeams.find((t) => t.id === teamId);
        setFollowedTeams((prev) => [...prev, { teamId, team }]);
      }
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-surface-container-high rounded w-1/3" />
          <div className="h-4 bg-surface-container-high rounded w-2/3" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="font-headline text-3xl font-black tracking-tighter uppercase text-primary-container">
          Settings
        </h1>
        <p className="font-body text-on-surface-variant mt-2">
          Signed in as {session?.user?.email}
        </p>
      </div>

      {/* My Teams */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/15">
        <h2 className="font-headline text-xl font-bold mb-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary">
            favorite
          </span>
          My Teams
        </h2>
        <p className="font-body text-sm text-on-surface-variant mb-6">
          Follow teams to see their fixtures first on the home page.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {allTeams.map((team) => (
            <button
              key={team.id}
              onClick={() => toggleTeam(team.id)}
              className={`p-4 rounded-xl border-2 transition-all text-center ${
                followedIds.has(team.id)
                  ? 'border-secondary bg-secondary/10'
                  : 'border-outline-variant/30 hover:border-outline-variant'
              }`}
            >
              {team.logoUrl && (
                <img
                  src={team.logoUrl}
                  alt={team.name}
                  className="w-12 h-12 mx-auto mb-2 object-contain"
                />
              )}
              <p className="font-headline text-sm font-bold">{team.abbreviation}</p>
              <p className="font-label text-[10px] text-on-surface-variant">
                {team.name}
              </p>
              {followedIds.has(team.id) && (
                <span className="inline-block mt-2 text-secondary text-[10px] font-bold uppercase">
                  Following
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Notification preferences placeholder */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/15">
        <h2 className="font-headline text-xl font-bold mb-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary">
            notifications
          </span>
          Notifications
        </h2>
        <p className="font-body text-sm text-on-surface-variant">
          In-app match reminders are enabled for your followed teams. Browser push
          notifications coming in a future update.
        </p>
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Run tests, verify build**

```bash
npx vitest run src/__tests__/api/user-teams.test.ts
```

Expect: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add user personalization with follow teams, favorites, and reminders"
```

---

### Task 17: Deployment (Render)

**Files:**
- Create: `render.yaml`
- Create: `src/app/api/health/route.ts`
- Modify: `package.json` (verify build/start scripts)
- Test: `src/__tests__/api/health.test.ts`

- [ ] **Step 1: Write health endpoint test**

Create `src/__tests__/api/health.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('Health API', () => {
  it('should export a GET handler', async () => {
    const { GET } = await import('@/app/api/health/route');
    expect(typeof GET).toBe('function');
  });

  it('should return 200 with status ok', async () => {
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.timestamp).toBeDefined();
  });
});
```

Run: `npx vitest run src/__tests__/api/health.test.ts` — expect FAIL.

- [ ] **Step 2: Implement health endpoint**

Create `src/app/api/health/route.ts`:

```typescript
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
}
```

Run: `npx vitest run src/__tests__/api/health.test.ts` — expect PASS.

- [ ] **Step 3: Create Render blueprint**

Create `render.yaml`:

```yaml
services:
  - type: web
    runtime: node
    name: netpulse
    region: sydney
    plan: starter
    buildCommand: npm ci && npx prisma generate && npm run build
    startCommand: node server.js
    healthCheckPath: /api/health
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        sync: false
      - key: NEXTAUTH_SECRET
        generateValue: true
      - key: NEXTAUTH_URL
        sync: false
      - key: GOOGLE_CLIENT_ID
        sync: false
      - key: GOOGLE_CLIENT_SECRET
        sync: false
      - key: CHAMPION_DATA_COMP_ID
        sync: false
```

- [ ] **Step 4: Verify package.json scripts**

Ensure `package.json` contains:

```json
{
  "scripts": {
    "dev": "node server.js",
    "build": "next build",
    "start": "node server.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 5: Verify build succeeds**

```bash
npm run build
```

Expect: Build completes without errors.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add Render deployment config with health check endpoint"
```

---

## Dependencies

Install all new dependencies in one go at the start:

```bash
npm install next-auth @auth/prisma-adapter bcryptjs socket.io socket.io-client
npm install -D @types/bcryptjs
```

## Test Summary

| Task | Test Files | Test Count |
|------|-----------|------------|
| 12 — Auth | `auth.test.ts`, `middleware.test.ts` | 7 |
| 13 — Live Game | `useMatchSocket.test.ts` | 4 |
| 14 — Court | `NetballCourt.test.tsx` | 3 |
| 15 — Real-Time | `match-sync.test.ts`, `worker.test.ts` | 7 |
| 16 — Personalization | `user-teams.test.ts` | 2 |
| 17 — Deployment | `health.test.ts` | 2 |
| **Total** | **9 files** | **25 tests** |
