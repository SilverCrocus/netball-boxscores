import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
vi.mock('@/lib/db', () => ({
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
    const { prisma } = await import('@/lib/db');
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
    const { prisma } = await import('@/lib/db');
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
      { email: ' Test@Example.COM ', password: 'correct' },
      {} as any
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'test@example.com' },
    });
    expect(result).toEqual({
      id: '1',
      email: 'test@example.com',
      name: 'Test User',
    });
  });
});
