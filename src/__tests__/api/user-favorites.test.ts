import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    userFavorite: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccess: vi.fn().mockResolvedValue({ id: 'match-1' }),
  resolvePublicMatchAccessBatch: vi.fn().mockResolvedValue(new Map([['match-1', { id: 'match-1' }]])),
}));

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

describe('User Favorites API', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const publicMatch = await import('@/lib/public-match');
    vi.mocked(publicMatch.resolvePublicMatchAccess).mockResolvedValue({ id: 'match-1' } as any);
    vi.mocked(publicMatch.resolvePublicMatchAccessBatch).mockResolvedValue(
      new Map([['match-1', { id: 'match-1' }]]) as any,
    );
  });

  it('should return 401 if not authenticated', async () => {
    const { getServerSession } = await import('next-auth');
    (getServerSession as any).mockResolvedValue(null);

    const { GET } = await import('@/app/api/user/favorites/route');
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('should return user favorites when authenticated', async () => {
    const { getServerSession } = await import('next-auth');
    const { prisma } = await import('@/lib/db');

    (getServerSession as any).mockResolvedValue({
      user: { id: 'user-1' },
    });
    (prisma.userFavorite.findMany as any).mockResolvedValue([
      {
        userId: 'user-1',
        matchId: 'match-1',
        match: {
          id: 'match-1',
          homeTeam: { name: 'Vixens' },
          awayTeam: { name: 'Swifts' },
        },
      },
    ]);

    const { GET } = await import('@/app/api/user/favorites/route');
    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveLength(1);
    expect(data[0].match.homeTeam.name).toBe('Vixens');
  });

  it('should return 400 if matchId is missing on POST', async () => {
    const { getServerSession } = await import('next-auth');
    (getServerSession as any).mockResolvedValue({
      user: { id: 'user-1' },
    });

    const { POST } = await import('@/app/api/user/favorites/route');
    const request = new Request('http://localhost/api/user/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('treats duplicate POST as an idempotent success', async () => {
    const { getServerSession } = await import('next-auth');
    const { prisma } = await import('@/lib/db');
    (getServerSession as any).mockResolvedValue({ user: { id: 'user-1' } });
    (prisma.userFavorite.create as any).mockRejectedValue({ code: 'P2002' });
    (prisma.userFavorite.findUnique as any).mockResolvedValue({
      userId: 'user-1', matchId: 'match-1',
    });

    const { POST } = await import('@/app/api/user/favorites/route');
    const response = await POST(new Request('http://localhost/api/user/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: 'match-1' }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: 'user-1', matchId: 'match-1' });
  });

  it('treats deleting a missing favorite as an idempotent success', async () => {
    const { getServerSession } = await import('next-auth');
    const { prisma } = await import('@/lib/db');
    (getServerSession as any).mockResolvedValue({ user: { id: 'user-1' } });
    (prisma.userFavorite.delete as any).mockRejectedValue({ code: 'P2025' });

    const { DELETE } = await import('@/app/api/user/favorites/route');
    const response = await DELETE(new Request('http://localhost/api/user/favorites', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: 'match-1' }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it('does not allow an authenticated user to save a private match', async () => {
    const { getServerSession } = await import('next-auth');
    const { prisma } = await import('@/lib/db');
    const publicMatch = await import('@/lib/public-match');
    (getServerSession as any).mockResolvedValue({ user: { id: 'user-1' } });
    vi.mocked(publicMatch.resolvePublicMatchAccess).mockResolvedValue(null);

    const { POST } = await import('@/app/api/user/favorites/route');
    const response = await POST(new Request('http://localhost/api/user/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: 'draft-match' }),
    }));

    expect(response.status).toBe(404);
    expect(prisma.userFavorite.create).not.toHaveBeenCalled();
  });
});
