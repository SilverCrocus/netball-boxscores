import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('hashed-password') },
}));

describe('Signup API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizes email before lookup and creation', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: 'user-1' } as any);
    const { POST } = await import('@/app/api/auth/signup/route');

    const response = await POST(new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: ' Test User ',
        email: ' Test@Example.COM ',
        password: 'password123',
      }),
    }));

    expect(response.status).toBe(201);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'test@example.com' },
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        name: 'Test User',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
      },
    });
  });

  it('does not reveal whether an account already exists', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'existing-user' } as any);
    const { POST } = await import('@/app/api/auth/signup/route');

    const response = await POST(new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.20' },
      body: JSON.stringify({ email: 'existing@example.com', password: 'password123' }),
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects cross-origin requests before doing password work', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const { POST } = await import('@/app/api/auth/signup/route');
    const response = await POST(new Request('https://centrepass.example/api/auth/signup', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', password: 'password123' }),
    }));

    expect(response.status).toBe(403);
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });
});
