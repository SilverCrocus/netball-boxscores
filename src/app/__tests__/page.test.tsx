import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import HomePage from '../page';

vi.mock('@/components/home/MyTeams', () => ({ MyTeams: () => null }));

const { findCompetitionsMock, findMatchesMock } = vi.hoisted(() => ({
  findCompetitionsMock: vi.fn(),
  findMatchesMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  excludeSimData: {},
  prisma: {
    competition: { findMany: findCompetitionsMock },
    match: {
      findMany: findMatchesMock,
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
          currentTime: '04:12',
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CENTREPASS_PREVIEW_DATA_MODE;
    delete process.env.CENTREPASS_UPSTREAM_ORIGIN;
  });

  it('renders a state-aware live heading', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText('LIVE NOW')).toBeInTheDocument();
  });

  it('renders LIVE ACTION section when live matches exist', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText('LIVE ACTION')).toBeInTheDocument();
  });

  it('renders UPCOMING FIXTURES section', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText('UPCOMING FIXTURES')).toBeInTheDocument();
  });

  it('renders "Next Match" label instead of "Match of the Day"', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText(/Next Match/)).toBeInTheDocument();
    expect(screen.queryByText(/Match of the Day/)).not.toBeInTheDocument();
  });

  it('renders full team names in side fixtures', async () => {
    const page = await HomePage();
    render(page);
    // Second scheduled match appears in side fixtures with full names
    expect(screen.getByText(/Titans v Rockets/)).toBeInTheDocument();
    expect(screen.queryByText(/TIT v ROC/)).not.toBeInTheDocument();
  });

  it('renders RESULTS section with round headings', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText('RESULTS')).toBeInTheDocument();
    expect(screen.getByText('Round 5')).toBeInTheDocument();
    expect(screen.getByText('Round 4')).toBeInTheDocument();
  });

  it('renders results grouped by round in descending order', async () => {
    const page = await HomePage();
    render(page);
    const round5 = screen.getByText('Round 5');
    const round4 = screen.getByText('Round 4');
    // Round 5 should appear before Round 4 in the DOM
    expect(round5.compareDocumentPosition(round4) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows finals stages ahead of the regular-season rounds', async () => {
    const grandFinal = {
      ...MATCHES[3],
      id: 'grand-final',
      round: 3,
      finalCode: 'GRAND',
      scheduledAt: new Date('2026-07-04T09:30:00Z'),
    };
    const round14 = {
      ...MATCHES[4],
      id: 'round-14',
      round: 14,
      finalCode: null,
      scheduledAt: new Date('2026-06-14T06:00:00Z'),
    };
    const finalsMatches = [grandFinal, round14];
    findMatchesMock.mockImplementation(({ where }: {
      where: { status?: string; id?: { in: string[] } };
    }) => Promise.resolve(
      where.status === 'COMPLETED'
        ? finalsMatches
        : where.id?.in
          ? finalsMatches.filter((match) => where.id?.in.includes(match.id))
          : [],
    ));

    render(await HomePage());

    const grandFinalHeading = screen.getByText('Grand Final');
    const round14Heading = screen.getByText('Round 14');
    expect(
      grandFinalHeading.compareDocumentPosition(round14Heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('does not show Final badge in results', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.queryByText('Final')).not.toBeInTheDocument();
  });

  it('derives one-point goals by excluding super shots from total made goals', async () => {
    render(await HomePage());

    expect(screen.getByText('(60.2)')).toBeInTheDocument();
    expect(screen.queryByText('(62.2)')).not.toBeInTheDocument();
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

    expect(scheduledQuery.take).toBe(4);
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

  it('distinguishes database failures from a true empty season', async () => {
    findCompetitionsMock.mockRejectedValue(new Error('database unavailable'));

    render(await HomePage());

    expect(screen.getByRole('alert')).toHaveTextContent('Scores temporarily unavailable');
    expect(screen.queryByText('No fixtures yet')).not.toBeInTheDocument();
  });

  it('renders hosted results in explicit localhost preview mode without querying the database', async () => {
    process.env.CENTREPASS_PREVIEW_DATA_MODE = 'upstream';
    process.env.CENTREPASS_UPSTREAM_ORIGIN = 'https://centrepass.example';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        groups: [{
          label: 'Grand Final',
          matches: [{
            id: 'hosted-grand-final',
            status: 'COMPLETED',
            scoreAvailable: true,
            scheduledAt: '2026-07-04T09:30:00.000Z',
            homeScore: 61,
            awayScore: 40,
            venue: 'John Cain Arena',
            round: 3,
            finalCode: 'GRAND',
            homeTeam: { name: 'Adelaide Thunderbirds', abbreviation: 'THU', logoUrl: null },
            awayTeam: { name: 'Melbourne Vixens', abbreviation: 'VIX', logoUrl: null },
          }],
        }],
        nextCursor: null,
      }),
    }));

    render(await HomePage());

    expect(screen.getByText('RESULTS')).toBeInTheDocument();
    expect(screen.getByText('Adelaide Thunderbirds')).toBeInTheDocument();
    expect(screen.getByText(/Local preview: showing current CentrePass results/)).toBeInTheDocument();
    expect(findCompetitionsMock).not.toHaveBeenCalled();
  });
});
