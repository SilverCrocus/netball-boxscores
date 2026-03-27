import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    match: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    player: {
      findMany: vi.fn(),
    },
    playerMatchStats: {
      upsert: vi.fn(),
    },
    matchQuarter: {
      upsert: vi.fn(),
    },
    scoreFlow: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('match-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect score changes and return changed matches', async () => {
    const { prisma } = await import('@/lib/db');
    const { detectChanges } = await import('@/lib/match-sync');

    (prisma.match.findUnique as any).mockResolvedValue({
      id: 'match-1',
      championDataMatchId: 100,
      homeScore: 30,
      awayScore: 28,
      status: 'LIVE',
    });

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

    (prisma.match.findUnique as any).mockResolvedValue({
      id: 'match-1',
      championDataMatchId: 100,
      homeScore: 30,
      awayScore: 28,
      status: 'LIVE',
    });

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

  it('should persist score flow entries in applyChanges', async () => {
    const { prisma } = await import('@/lib/db');
    const { applyChanges } = await import('@/lib/match-sync');

    const changes = {
      matchId: 'match-1',
      scoreChanged: true,
      statusChanged: false,
      newHomeScore: 32,
      newAwayScore: 28,
      newStatus: 'LIVE' as const,
      currentQuarter: 2,
      currentTime: '450',
    };

    const incoming = {
      matchId: 100,
      homeScore: 32,
      awayScore: 28,
      status: 'LIVE',
      currentQuarter: 2,
      currentTime: '450',
      scoreFlow: [
        {
          period: 1,
          periodSeconds: 200,
          squadId: 810,
          scorepoints: 1,
          homeScore: 15,
          awayScore: 14,
          scoringTeamPrismaId: 'team-home',
        },
        {
          period: 2,
          periodSeconds: 100,
          squadId: 811,
          scorepoints: 1,
          homeScore: 30,
          awayScore: 28,
          scoringTeamPrismaId: 'team-away',
        },
      ],
    };

    (prisma.match.update as any).mockResolvedValue({});
    (prisma.scoreFlow.upsert as any).mockResolvedValue({});

    await applyChanges(changes, incoming);

    expect(prisma.scoreFlow.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.scoreFlow.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          matchId_period_periodSeconds: {
            matchId: 'match-1',
            period: 1,
            periodSeconds: 200,
          },
        }),
      })
    );
  });

  it('should detect status change from LIVE to COMPLETED', async () => {
    const { prisma } = await import('@/lib/db');
    const { detectChanges } = await import('@/lib/match-sync');

    (prisma.match.findUnique as any).mockResolvedValue({
      id: 'match-1',
      championDataMatchId: 100,
      homeScore: 55,
      awayScore: 50,
      status: 'LIVE',
    });

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
