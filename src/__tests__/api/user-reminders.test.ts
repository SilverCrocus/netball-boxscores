import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    userReminder: {
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

describe('User Reminders API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 if not authenticated', async () => {
    const { getServerSession } = await import('next-auth');
    (getServerSession as any).mockResolvedValue(null);

    const { GET } = await import('@/app/api/user/reminders/route');
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('should return user reminders when authenticated', async () => {
    const { getServerSession } = await import('next-auth');
    const { prisma } = await import('@/lib/db');

    (getServerSession as any).mockResolvedValue({
      user: { id: 'user-1' },
    });
    (prisma.userReminder.findMany as any).mockResolvedValue([
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

    const { GET } = await import('@/app/api/user/reminders/route');
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

    const { POST } = await import('@/app/api/user/reminders/route');
    const request = new Request('http://localhost/api/user/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
