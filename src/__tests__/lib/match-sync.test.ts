import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
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
    const { prisma } = await import('@/lib/db');
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
    const { prisma } = await import('@/lib/db');
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
    const { prisma } = await import('@/lib/db');
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
