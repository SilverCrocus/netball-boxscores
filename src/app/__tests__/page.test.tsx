import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import HomePage from '../page';

vi.mock('@/components/home/MyTeams', () => ({ MyTeams: () => null }));
vi.mock('@/components/home/HomeResults', () => ({
  HomeResults: () => <section>Long results archive</section>,
}));

const { findCompetitionsMock, findMatchesMock, findStandingsMock } = vi.hoisted(() => ({
  findCompetitionsMock: vi.fn(),
  findMatchesMock: vi.fn(),
  findStandingsMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  excludeSimData: {},
  prisma: {
    competition: { findMany: findCompetitionsMock },
    match: {
      findMany: findMatchesMock,
    },
    standing: {
      findMany: findStandingsMock,
    },
  },
}));

vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccessBatch: vi.fn().mockImplementation(async (matchIds: string[]) => new Map(
    matchIds.map((matchId) => [matchId, {
      status: 'COMPLETED',
      resultQuality: 'OFFICIAL_FINAL',
      sourceUpdatedAt: new Date('2026-07-25T09:00:01.000Z'),
      scoreAvailable: true,
      features: { superShots: { available: true } },
    }]),
  )),
  canExposePublicMatchScore: (access: { scoreAvailable: boolean }) => access.scoreAvailable,
}));

const PUBLIC_COVERAGE = [
  { capability: 'FINAL_SCORE', state: 'AVAILABLE' },
  { capability: 'SUPER_SHOTS', state: 'AVAILABLE' },
] as const;

const MATCHES = [
  {
          id: '1',
          competitionId: 'competition-2026',
          status: 'LIVE',
          homeScore: 42,
          awayScore: 38,
          currentQuarter: 3,
          currentTime: '312',
          round: 12,
          venue: 'Arena',
          scheduledAt: new Date(),
          homeTeamId: 'team-mar',
          awayTeamId: 'team-inf',
          homeTeam: { name: 'Marlins', abbreviation: 'MAR', logoUrl: null },
          awayTeam: { name: 'Inferno', abbreviation: 'INF', logoUrl: null },
          teamStats: [],
        },
        {
          id: '2',
          competitionId: 'competition-2026',
          status: 'SCHEDULED',
          homeScore: 0,
          awayScore: 0,
          currentQuarter: null,
          currentTime: null,
          round: 12,
          venue: 'Stadium',
          scheduledAt: new Date(Date.now() + 86400000),
          homeTeamId: 'team-wol',
          awayTeamId: 'team-har',
          homeTeam: { name: 'Wolves', abbreviation: 'WOL', logoUrl: null },
          awayTeam: { name: 'Harbor', abbreviation: 'HAR', logoUrl: null },
          teamStats: [],
        },
        {
          id: '5',
          competitionId: 'competition-2026',
          status: 'SCHEDULED',
          homeScore: 0,
          awayScore: 0,
          currentQuarter: null,
          currentTime: null,
          round: 13,
          venue: 'Dome',
          scheduledAt: new Date(Date.now() + 172800000),
          homeTeamId: 'team-tit',
          awayTeamId: 'team-roc',
          homeTeam: { name: 'Titans', abbreviation: 'TIT', logoUrl: null },
          awayTeam: { name: 'Rockets', abbreviation: 'ROC', logoUrl: null },
          teamStats: [],
        },
        {
          id: '3',
          competitionId: 'competition-2026',
          status: 'COMPLETED',
          homeScore: 64,
          awayScore: 58,
          currentQuarter: null,
          currentTime: null,
          round: 5,
          venue: 'RAC Arena',
          scheduledAt: new Date('2026-04-05T05:00:00Z'),
          homeTeamId: 'team-vix',
          awayTeamId: 'team-fev',
          homeTeam: { name: 'Vixens', abbreviation: 'VIX', logoUrl: null },
          awayTeam: { name: 'Fever', abbreviation: 'FEV', logoUrl: null },
          teamStats: [
            { teamId: 'team-vix', goals: 62, goal2: 2 },
            { teamId: 'team-fev', goals: 58, goal2: 0 },
          ],
        },
        {
          id: '4',
          competitionId: 'competition-2026',
          status: 'COMPLETED',
          homeScore: 71,
          awayScore: 65,
          currentQuarter: null,
          currentTime: null,
          round: 4,
          venue: 'USC Stadium',
          scheduledAt: new Date('2026-03-29T03:00:00Z'),
          homeTeamId: 'team-swi',
          awayTeamId: 'team-lig',
          homeTeam: { name: 'Swifts', abbreviation: 'SWI', logoUrl: null },
          awayTeam: { name: 'Lightning', abbreviation: 'LIG', logoUrl: null },
          teamStats: [],
        },
].map((match) => ({
  resultQuality: match.status === 'COMPLETED' ? 'OFFICIAL_FINAL' : 'UNKNOWN',
  roundLabel: null,
  finalCode: null,
  stage: null,
  competition: { dataCoverage: PUBLIC_COVERAGE },
  dataCoverage: [],
  sourceUpdatedAt: new Date('2026-07-25T09:00:01.000Z'),
  ...match,
}));

describe('HomePage', () => {
  beforeEach(() => {
    delete process.env.CENTREPASS_PREVIEW_DATA_MODE;
    delete process.env.CENTREPASS_UPSTREAM_ORIGIN;
    findCompetitionsMock.mockReset().mockResolvedValue([{
      id: 'competition-2026',
      name: 'Suncorp Super Netball',
      season: 2026,
      slug: '2026',
      publicationStatus: 'PUBLISHED',
      series: { id: 'ssn', slug: 'ssn', name: 'Suncorp Super Netball', kind: 'LEAGUE' },
      ruleset: null,
      dataCoverage: PUBLIC_COVERAGE,
      _count: { entries: 8, matches: MATCHES.length },
      stages: [],
      matches: [],
      importRuns: [],
      seasonStart: new Date('2026-03-01T00:00:00Z'),
      seasonEnd: new Date('2026-07-31T00:00:00Z'),
    }]);
    findMatchesMock.mockReset().mockImplementation(({ where }: {
      where: { status?: string; id?: { in: string[] } };
    }) => Promise.resolve(
      where.status
        ? MATCHES.filter((match) => match.status === where.status)
        : where.id?.in
          ? MATCHES.filter((match) => where.id?.in.includes(match.id))
          : [],
    ));
    findStandingsMock.mockReset().mockResolvedValue([{
      id: 'standing-vixens',
      rank: 1,
      played: 14,
      wins: 12,
      losses: 2,
      goalsFor: 850,
      goalsAgainst: 720,
      points: 48,
      team: {
        name: 'Melbourne Vixens',
        abbreviation: 'VIX',
        logoUrl: null,
      },
    }]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.CENTREPASS_PREVIEW_DATA_MODE;
    delete process.env.CENTREPASS_UPSTREAM_ORIGIN;
  });

  it('renders the branded landing hero for the current edition', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByRole('heading', {
      name: /Every match[\s\S]*Every team[\s\S]*Every story/i,
    })).toBeInTheDocument();
    expect(screen.getByText('Suncorp Super Netball · 2026')).toBeInTheDocument();
  });

  it('promotes live matches into the latest score strip', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByRole('region', { name: 'Latest scores' })).toBeInTheDocument();
    expect(screen.getByRole('link', {
      name: /Marlins 42, Inferno 38.*LIVE.*Q3 9:48/i,
    })).toHaveAttribute('href', '/match/1?edition=competition-2026');
  });

  it('labels and formats overtime clocks in the latest score strip', async () => {
    const overtimeMatch = {
      ...MATCHES[0],
      currentQuarter: 5,
      currentTime: '75',
    };
    findMatchesMock.mockImplementation(({ where }: {
      where: { status?: string; id?: { in: string[] } };
    }) => Promise.resolve(
      where.status === 'LIVE'
        ? [overtimeMatch]
        : where.status
          ? MATCHES.filter((match) => match.status === where.status)
          : where.id?.in
            ? MATCHES.filter((match) => where.id?.in.includes(match.id))
            : [],
    ));

    render(await HomePage());

    expect(screen.getByRole('link', {
      name: /Marlins 42, Inferno 38.*LIVE.*ET 3:45/i,
    })).toHaveAttribute('href', '/match/1?edition=competition-2026');
  });

  it('renders the upcoming fixtures preview', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByRole('heading', { name: 'Upcoming fixtures' })).toBeInTheDocument();
  });

  it('renders the primary edition action and today matches action', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByRole('link', { name: 'Explore 2026' })).toHaveAttribute(
      'href',
      '/competitions/ssn/2026',
    );
    expect(screen.getByRole('link', { name: /See today's matches/i })).toHaveAttribute(
      'href',
      '/live',
    );
  });

  it('renders full team names in fixture links', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByRole('link', {
      name: /Titans versus Rockets/i,
    })).toBeInTheDocument();
    expect(screen.queryByText(/TIT v ROC/)).not.toBeInTheDocument();
  });

  it('keeps completed scores in the score strip and a compact recent-results section', async () => {
    render(await HomePage());

    const scoreStrip = screen.getByRole('region', { name: 'Latest scores' });
    expect(scoreStrip).toHaveTextContent('Vixens');
    expect(scoreStrip).toHaveTextContent('Fever');
    expect(screen.getByRole('heading', { name: 'Recent results' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Recent results' })).toBeInTheDocument();
    expect(screen.queryByText('Long results archive')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'RESULTS' })).not.toBeInTheDocument();
  });

  it('keeps the compact standings table for league editions', async () => {
    render(await HomePage());

    expect(screen.getByRole('table', { name: 'Standings' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /Melbourne Vixens/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View full standings/i })).toHaveAttribute(
      'href',
      '/competitions/ssn/2026/standings',
    );
  });

  it('stacks confirmed tournament fixtures above recent results', async () => {
    findCompetitionsMock.mockResolvedValue([{
      id: 'world-cup-2027',
      name: 'Netball World Cup — Sydney 2027',
      label: 'Sydney 2027',
      season: 2027,
      slug: 'sydney-2027',
      publicationStatus: 'PUBLISHED',
      series: {
        id: 'netball-world-cup',
        slug: 'netball-world-cup',
        name: 'Netball World Cup',
        kind: 'TOURNAMENT',
      },
      ruleset: null,
      dataCoverage: PUBLIC_COVERAGE,
      _count: { entries: 12, matches: MATCHES.length },
      stages: [],
      matches: [],
      importRuns: [],
      seasonStart: new Date('2027-08-25T00:00:00Z'),
      seasonEnd: new Date('2027-09-05T00:00:00Z'),
      sourceTimezone: 'Australia/Sydney',
    }]);

    render(await HomePage());

    const upcomingHeading = screen.getByRole('heading', { name: 'Upcoming fixtures' });
    const recentHeading = screen.getByRole('heading', { name: 'Recent results' });
    expect(
      upcomingHeading.compareDocumentPosition(recentHeading)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(upcomingHeading.closest('section')?.parentElement).toHaveClass('space-y-10');
    expect(upcomingHeading.closest('section')?.parentElement).not.toHaveClass('grid');
    expect(screen.getByRole('link', { name: /Titans versus Rockets/i })).toBeInTheDocument();
    expect(screen.queryByText('TBD')).not.toBeInTheDocument();
    expect(screen.queryByText('Pool A & Pool B standings')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(findStandingsMock).not.toHaveBeenCalled();
  });

  it('limits fixture and initial results loading', async () => {
    await HomePage();

    const scheduledQuery = findMatchesMock.mock.calls.find(
      ([query]) => query.where.status === 'SCHEDULED',
    )?.[0];
    const liveQuery = findMatchesMock.mock.calls.find(
      ([query]) => query.where.status === 'LIVE',
    )?.[0];
    const completedQuery = findMatchesMock.mock.calls.find(
      ([query]) => query.where.status === 'COMPLETED',
    )?.[0];
    const hydratedResultsQuery = findMatchesMock.mock.calls.find(
      ([query]) => query.where.id?.in,
    )?.[0];

    expect(scheduledQuery.take).toBe(5);
    expect(scheduledQuery.where.scheduledAt.gte).toBeInstanceOf(Date);
    expect(scheduledQuery.where.homeTeamId).toEqual({ not: null });
    expect(scheduledQuery.where.awayTeamId).toEqual({ not: null });
    expect(liveQuery.take).toBe(16);
    expect(liveQuery.where.OR).toEqual([
      { stageId: null },
      { stage: { is: { isPublished: true } } },
    ]);
    expect(scheduledQuery.where.OR).toEqual([
      { stageId: null },
      { stage: { is: { isPublished: true } } },
    ]);
    expect(completedQuery.take).toBe(73);
    expect(completedQuery.where.competitionId).toBe('competition-2026');
    expect(completedQuery.where.AND).toEqual(expect.arrayContaining([{
      OR: [
        { stageId: null },
        { stage: { is: { isPublished: true } } },
      ],
    }]));
    expect(completedQuery.select.scoreFlow).toBeUndefined();
    expect(completedQuery.select.teamStats).toBeUndefined();
    expect(hydratedResultsQuery.select.teamStats).toBeDefined();
  });

  it('renders a true empty state when the latest season has no matches', async () => {
    findMatchesMock.mockResolvedValue([]);

    render(await HomePage());

    expect(screen.getByText('No fixtures yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('treats an invisible completed-results cursor as an empty homepage', async () => {
    const filteredCompletedCandidates = Array.from({ length: 73 }, (_, index) => ({
      id: `filtered-completed-${index}`,
      scheduledAt: new Date(Date.UTC(2026, 6, 30, 12, 0, index)),
    }));
    findMatchesMock.mockImplementation(({ where }: {
      where: { status?: string; id?: { in: string[] } };
    }) => Promise.resolve(
      where.status === 'COMPLETED'
        ? filteredCompletedCandidates
        : [],
    ));

    render(await HomePage());

    expect(screen.getByText('No fixtures yet')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recent results' })).not.toBeInTheDocument();
  });

  it('distinguishes database failures from a true empty season', async () => {
    findCompetitionsMock.mockRejectedValue(new Error('database unavailable'));

    render(await HomePage());

    expect(screen.getByRole('alert')).toHaveTextContent('Scores temporarily unavailable');
    expect(screen.queryByText('No fixtures yet')).not.toBeInTheDocument();
  });

  it('distinguishes unavailable league standings from an unpublished table', async () => {
    findStandingsMock.mockRejectedValue(new Error('standings unavailable'));

    render(await HomePage());

    expect(screen.getByText(
      'Standings are temporarily unavailable. Please try again shortly.',
    )).toBeInTheDocument();
    expect(screen.queryByText(
      'Standings will appear once the competition table is published.',
    )).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders hosted results and fixtures in preview mode without querying the database', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T07:30:00.000Z'));
    process.env.CENTREPASS_PREVIEW_DATA_MODE = 'upstream';
    process.env.CENTREPASS_UPSTREAM_ORIGIN = 'https://centrepass.example';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        groups: [{
          label: 'Pool A — 2026-07-30',
          matches: [{
            id: 'hosted-england-south-africa',
            status: 'COMPLETED',
            scoreAvailable: true,
            scheduledAt: '2026-07-30T20:00:00.000Z',
            homeScore: 58,
            awayScore: 54,
            venue: 'The Hydro',
            round: null,
            homeTeam: { name: 'England', abbreviation: 'ENG', logoUrl: null },
            awayTeam: { name: 'South Africa', abbreviation: 'RSA', logoUrl: null },
          }],
        }],
        upcomingFixtures: [{
          id: 'hosted-england-australia-semi',
          competitionId: 'glasgow-2026',
          href: 'javascript:alert(1)',
          status: 'SCHEDULED',
          scheduledAt: '2026-08-03T12:00:00.000Z',
          venue: 'The Hydro',
          homeTeam: { name: 'England', abbreviation: 'ENG', logoUrl: null },
          awayTeam: { name: 'Australia', abbreviation: 'AUS', logoUrl: null },
        }],
        nextCursor: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(await HomePage());

    expect(screen.getAllByText('England').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Recent results' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Upcoming fixtures' })).toBeInTheDocument();
    expect(screen.queryByText(
      'Knockout fixtures will appear here as soon as both teams are confirmed.',
    )).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /England versus Australia at The Hydro/i }))
      .toHaveAttribute(
        'href',
        'https://centrepass.example/match/hosted-england-australia-semi?edition=glasgow-2026',
      );
    expect(screen.getByRole('link', { name: 'View all fixtures' })).toHaveAttribute(
      'href',
      'https://centrepass.example/competitions/commonwealth-games-netball/glasgow-2026',
    );
    expect(screen.queryByText('TBD')).not.toBeInTheDocument();
    expect(screen.queryByText('Pool A & Pool B standings')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Recent results' })).getByRole('link', {
      name: /England 58, South Africa 54/i,
    })).toHaveAttribute('href', 'https://centrepass.example/match/hosted-england-south-africa');
    expect(screen.getByRole('link', { name: /See today's matches/i })).toHaveAttribute(
      'href',
      'https://centrepass.example/live',
    );
    expect(screen.queryByText('Long results archive')).not.toBeInTheDocument();
    expect(screen.getByText(/Local preview: showing current CentrePass results/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://centrepass.example/api/matches?competitionSlug=commonwealth-games-netball&editionSlug=glasgow-2026&includeUpcoming=true',
      expect.any(Object),
    );
    expect(findCompetitionsMock).not.toHaveBeenCalled();
  });
});
