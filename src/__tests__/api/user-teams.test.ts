import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    userTeam: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    team: { findMany: vi.fn().mockResolvedValue([{ id: 'team-1' }]) },
  },
}));

vi.mock('@/lib/competitions', () => ({
  getPublicCompetitions: vi.fn().mockResolvedValue([{ id: 'competition-1' }]),
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
    const { prisma } = await import('@/lib/db');

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
