import { render, screen } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import TeamPage from '../page';
import { getPublicCompetitions } from '@/lib/competitions';
import { prisma } from '@/lib/db';

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: redirectMock,
}));

vi.mock('@/lib/competitions', () => ({
  getPublicCompetitions: vi.fn(),
}));

vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccessBatch: vi.fn().mockImplementation(async (ids: string[]) => new Map(
    ids.map((id) => [id, { scoreAvailable: true }]),
  )),
  canExposePublicMatchScore: vi.fn().mockReturnValue(true),
}));

const ssnEdition = {
  id: 'competition-2026',
  season: 2026,
  name: 'Suncorp Super Netball',
  slug: '2026',
  label: 'SSN 2026',
  publicationStatus: 'PUBLISHED',
  series: { id: 'ssn', slug: 'ssn', name: 'Suncorp Super Netball', kind: 'LEAGUE' },
};

const glasgowEdition = {
  id: 'glasgow-id',
  season: 2026,
  name: 'Commonwealth Games Netball',
  slug: 'glasgow-2026',
  label: 'Glasgow 2026',
  publicationStatus: 'PUBLISHED',
  series: {
    id: 'commonwealth-games',
    slug: 'commonwealth-games-netball',
    name: 'Commonwealth Games Netball',
    kind: 'TOURNAMENT',
  },
};

const legacyPlayers = [
  { id: 'p1', name: 'Maya Sterling', position: 'GS', photoUrl: null },
  { id: 'p2', name: 'Elena Rodriguez', position: 'GA', photoUrl: null },
];

const ssnTeam = {
  id: 't1',
  name: 'Vipers Athletics',
  slug: 'vipers-athletics',
  abbreviation: 'VIP',
  logoUrl: null,
  competitionId: 'competition-2026',
  editionEntries: [],
  players: legacyPlayers,
  standings: [
    { rank: 1, played: 12, wins: 11, losses: 1, draws: 0, goalsFor: 645, goalsAgainst: 412, goalPercentage: 156.5, points: 44 },
  ],
  homeMatches: [
    { id: 'm1', status: 'COMPLETED', homeScore: 62, awayScore: 44, scheduledAt: new Date(), round: 10, venue: 'Arena', awayTeam: { name: 'Titans', abbreviation: 'TIT' } },
  ],
  awayMatches: [],
};

vi.mock('@/lib/db', () => ({
  excludeSimData: {},
  prisma: {
    competition: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'competition-2026',
          season: 2026,
          name: 'Suncorp Super Netball',
          slug: '2026',
          publicationStatus: 'PUBLISHED',
          series: { id: 'ssn', slug: 'ssn', name: 'Suncorp Super Netball', kind: 'LEAGUE' },
          _count: { entries: 8, matches: 56 },
          seasonStart: new Date('2026-03-01T00:00:00Z'),
          seasonEnd: new Date('2026-07-31T00:00:00Z'),
        },
      ]),
    },
    standing: {
      findUnique: vi.fn().mockResolvedValue({
        rank: 1,
        played: 12,
        wins: 11,
        losses: 1,
        draws: 0,
        goalsFor: 645,
        goalsAgainst: 412,
        goalPercentage: 156.5,
        points: 44,
      }),
    },
    rosterMembership: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    team: {
      findFirst: vi.fn(),
    },
    match: {
      findMany: vi.fn().mockImplementation(({ where }) => {
        if (where.status === 'COMPLETED') {
          return Promise.resolve([
            {
              id: 'm1', status: 'COMPLETED', homeTeamId: 't1', awayTeamId: 't2',
              homeScore: 62, awayScore: 44, scheduledAt: new Date('2026-06-01T04:00:00Z'),
              homeTeam: { name: 'Vipers Athletics', abbreviation: 'VIP', logoUrl: null },
              awayTeam: { name: 'Titans', abbreviation: 'TIT', logoUrl: null },
            },
            {
              id: 'm2', status: 'COMPLETED', homeTeamId: 't3', awayTeamId: 't1',
              homeScore: 50, awayScore: 50, scheduledAt: new Date('2026-05-25T04:00:00Z'),
              homeTeam: { name: 'Stars', abbreviation: 'STA', logoUrl: null },
              awayTeam: { name: 'Vipers Athletics', abbreviation: 'VIP', logoUrl: null },
            },
          ]);
        }
        return Promise.resolve([
          {
            id: 'm3', status: 'SCHEDULED', homeTeamId: 't1', awayTeamId: 't4',
            homeScore: 0, awayScore: 0, scheduledAt: new Date('2026-07-20T04:00:00Z'),
            homeTeam: { name: 'Vipers Athletics', abbreviation: 'VIP', logoUrl: null },
            awayTeam: { name: 'Firebirds', abbreviation: 'FIR', logoUrl: null },
          },
        ]);
      }),
    },
  },
}));

describe('TeamPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPublicCompetitions).mockResolvedValue([ssnEdition] as never);
    vi.mocked(prisma.team.findFirst).mockResolvedValue(ssnTeam as never);
  });

  it('renders team name', async () => {
    const page = await TeamPage({
      params: Promise.resolve({ teamSlug: 'vipers-athletics' }),
      searchParams: Promise.resolve({ edition: 'competition-2026' }),
    });
    render(page);
    expect(screen.getByText(/Vipers/)).toBeInTheDocument();
  });

  it('renders a national flag in the team hero when no logo is available', async () => {
    vi.mocked(getPublicCompetitions).mockResolvedValue([glasgowEdition] as never);
    vi.mocked(prisma.team.findFirst).mockResolvedValueOnce({
      ...ssnTeam,
      id: 'australia-team',
      name: 'Australia',
      slug: 'australia',
      abbreviation: 'AUS',
      competitionId: 'glasgow-id',
      editionEntries: [{ competitionId: 'glasgow-id' }],
      players: [],
    } as never);

    const page = await TeamPage({
      params: Promise.resolve({ teamSlug: 'australia' }),
      searchParams: Promise.resolve({ edition: 'glasgow-id' }),
    });
    render(page);

    expect(screen.getByRole('img', { name: 'Australia flag' }).getAttribute('src')).toContain(
      '/flags/glasgow-2026/au.svg',
    );
  });

  it('renders roster', async () => {
    const page = await TeamPage({
      params: Promise.resolve({ teamSlug: 'vipers-athletics' }),
      searchParams: Promise.resolve({ edition: 'competition-2026' }),
    });
    render(page);
    expect(screen.getByText('Maya Sterling')).toBeInTheDocument();
    expect(screen.getByText('Elena Rodriguez')).toBeInTheDocument();
  });

  it('renders ranking badge', async () => {
    const page = await TeamPage({
      params: Promise.resolve({ teamSlug: 'vipers-athletics' }),
      searchParams: Promise.resolve({ edition: 'competition-2026' }),
    });
    render(page);
    expect(screen.getByText(/Ranking #1/i)).toBeInTheDocument();
  });

  it('renders recent form section with win/loss', async () => {
    const page = await TeamPage({
      params: Promise.resolve({ teamSlug: 'vipers-athletics' }),
      searchParams: Promise.resolve({ edition: 'competition-2026' }),
    });
    render(page);
    expect(screen.getByText('Recent Form')).toBeInTheDocument();
    expect(screen.getByText('W')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.getByText('vs Titans')).toBeInTheDocument();
  });

  it('renders standing stats', async () => {
    const page = await TeamPage({
      params: Promise.resolve({ teamSlug: 'vipers-athletics' }),
      searchParams: Promise.resolve({ edition: 'competition-2026' }),
    });
    render(page);
    expect(screen.getByText('11-1-0')).toBeInTheDocument();
    expect(screen.getByText('44')).toBeInTheDocument();
  });

  it('queries recent and upcoming matches with independent ordering and limits', async () => {
    const { prisma } = await import('@/lib/db');
    await TeamPage({
      params: Promise.resolve({ teamSlug: 'vipers-athletics' }),
      searchParams: Promise.resolve({ edition: 'competition-2026' }),
    });

    expect(prisma.match.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        competitionId: 'competition-2026',
        status: 'COMPLETED',
      }),
      orderBy: { scheduledAt: 'desc' },
      take: 15,
    }));
    expect(prisma.match.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        competitionId: 'competition-2026',
        status: 'SCHEDULED',
        scheduledAt: { gte: expect.any(Date) },
      }),
      orderBy: { scheduledAt: 'asc' },
      take: 10,
    }));
    expect(prisma.standing.findUnique).toHaveBeenCalledWith({
      where: {
        competitionId_teamId: {
          competitionId: 'competition-2026',
          teamId: 't1',
        },
      },
    });
  });

  it('uses the selected edition roster instead of the legacy primary team relation', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(prisma.rosterMembership.findMany).mockResolvedValueOnce([
      {
        designatedPosition: 'WD',
        player: {
          id: 'canonical-player',
          name: 'Canonical International',
          position: 'C',
          photoUrl: null,
          photoSourceUrl: null,
          photoCredit: null,
          photoLicense: null,
        },
      },
    ] as never);

    const page = await TeamPage({
      params: Promise.resolve({ teamSlug: 'vipers-athletics' }),
      searchParams: Promise.resolve({ edition: 'competition-2026' }),
    });
    render(page);

    expect(screen.getByText('Canonical International')).toBeInTheDocument();
    expect(screen.getByText('WD')).toBeInTheDocument();
    expect(screen.queryByText('Maya Sterling')).not.toBeInTheDocument();
  });

  it('redirects an SSN-only team no-query default past globally latest Glasgow', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(getPublicCompetitions).mockResolvedValue([
      glasgowEdition,
      ssnEdition,
    ] as never);

    await expect(TeamPage({
      params: Promise.resolve({ teamSlug: 'vipers-athletics' }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow(
      'NEXT_REDIRECT:/team/vipers-athletics?edition=competition-2026',
    );

    expect(redirectMock).toHaveBeenCalledWith(
      '/team/vipers-athletics?edition=competition-2026',
    );
    expect(prisma.standing.findUnique).not.toHaveBeenCalled();
    expect(prisma.rosterMembership.findMany).not.toHaveBeenCalled();
    expect(prisma.match.findMany).not.toHaveBeenCalled();
  });

  it('redirects a legacy season selection to the canonical edition id', async () => {
    await expect(TeamPage({
      params: Promise.resolve({ teamSlug: 'vipers-athletics' }),
      searchParams: Promise.resolve({ season: '2026' }),
    })).rejects.toThrow(
      'NEXT_REDIRECT:/team/vipers-athletics?edition=competition-2026',
    );

    expect(redirectMock).toHaveBeenCalledWith(
      '/team/vipers-athletics?edition=competition-2026',
    );
  });

  it('redirects a competition-qualified edition slug to its canonical id', async () => {
    vi.mocked(getPublicCompetitions).mockResolvedValue([
      glasgowEdition,
      ssnEdition,
    ] as never);
    vi.mocked(prisma.team.findFirst).mockResolvedValueOnce({
      ...ssnTeam,
      editionEntries: [{ competitionId: 'glasgow-id' }],
    } as never);

    await expect(TeamPage({
      params: Promise.resolve({ teamSlug: 'vipers-athletics' }),
      searchParams: Promise.resolve({
        competition: 'commonwealth-games-netball',
        edition: 'glasgow-2026',
      }),
    })).rejects.toThrow('NEXT_REDIRECT:/team/vipers-athletics?edition=glasgow-id');

    expect(redirectMock).toHaveBeenCalledWith(
      '/team/vipers-athletics?edition=glasgow-id',
    );
  });

  it('404s an explicit Glasgow selection for an SSN-only club', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(getPublicCompetitions).mockResolvedValue([
      glasgowEdition,
      ssnEdition,
    ] as never);

    await expect(TeamPage({
      params: Promise.resolve({ teamSlug: 'vipers-athletics' }),
      searchParams: Promise.resolve({ edition: 'glasgow-id' }),
    })).rejects.toThrow('NEXT_NOT_FOUND');

    expect(prisma.standing.findUnique).not.toHaveBeenCalled();
    expect(prisma.rosterMembership.findMany).not.toHaveBeenCalled();
    expect(prisma.match.findMany).not.toHaveBeenCalled();
  });

  it('does not fall back to legacy club players for another active edition', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(getPublicCompetitions).mockResolvedValue([
      glasgowEdition,
      ssnEdition,
    ] as never);
    vi.mocked(prisma.team.findFirst).mockResolvedValueOnce({
      ...ssnTeam,
      editionEntries: [{ competitionId: 'glasgow-id' }],
    } as never);

    const page = await TeamPage({
      params: Promise.resolve({ teamSlug: 'vipers-athletics' }),
      searchParams: Promise.resolve({ edition: 'glasgow-id' }),
    });
    render(page);

    expect(screen.queryByText('Maya Sterling')).not.toBeInTheDocument();
    expect(screen.queryByText('Elena Rodriguez')).not.toBeInTheDocument();
  });

  it('loads only active edition entries for team identity resolution', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(getPublicCompetitions).mockResolvedValue([
      glasgowEdition,
      ssnEdition,
    ] as never);

    await TeamPage({
      params: Promise.resolve({ teamSlug: 'vipers-athletics' }),
      searchParams: Promise.resolve({ edition: 'competition-2026' }),
    });

    expect(prisma.team.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          {
            editionEntries: {
              some: {
                competitionId: { in: ['glasgow-id', 'competition-2026'] },
                status: 'ACTIVE',
              },
            },
          },
        ]),
      }),
      include: expect.objectContaining({
        editionEntries: {
          where: {
            competitionId: { in: ['glasgow-id', 'competition-2026'] },
            status: 'ACTIVE',
          },
          select: { competitionId: true },
        },
      }),
    }));
    expect(prisma.rosterMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        editionEntry: {
          competitionId: 'competition-2026',
          teamId: 't1',
          status: 'ACTIVE',
        },
        status: 'ACTIVE',
        validTo: null,
      },
    }));
  });
});
