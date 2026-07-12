import { render, screen } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import HomePage from '../page';

const { findCompetitionMock, findMatchesMock } = vi.hoisted(() => ({
  findCompetitionMock: vi.fn(),
  findMatchesMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  excludeSimData: {},
  prisma: {
    competition: { findFirst: findCompetitionMock },
    match: {
      findMany: findMatchesMock,
    },
  },
}));

const MATCHES = [
  {
          id: '1',
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
] as const;

describe('HomePage', () => {
  beforeEach(() => {
    findCompetitionMock.mockReset().mockResolvedValue({ id: 'competition-2026' });
    findMatchesMock.mockReset().mockImplementation(({ where }: { where: { status: string } }) =>
      Promise.resolve(MATCHES.filter((match) => match.status === where.status)),
    );
  });

  it('renders TODAY\'S PULSE heading', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText("TODAY'S PULSE")).toBeInTheDocument();
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
    findMatchesMock.mockImplementation(({ where }: { where: { status: string } }) =>
      Promise.resolve(where.status === 'COMPLETED' ? [grandFinal, round14] : []),
    );

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

  it('limits fixture loading while retaining every completed current-season result', async () => {
    await HomePage();

    const scheduledQuery = findMatchesMock.mock.calls.find(
      ([query]) => query.where.status === 'SCHEDULED',
    )?.[0];
    const completedQuery = findMatchesMock.mock.calls.find(
      ([query]) => query.where.status === 'COMPLETED',
    )?.[0];

    expect(scheduledQuery.take).toBe(4);
    expect(completedQuery.take).toBeUndefined();
    expect(completedQuery.where.competitionId).toBe('competition-2026');
    expect(completedQuery.select.scoreFlow).toBeUndefined();
    expect(completedQuery.select.teamStats).toBeDefined();
  });

  it('renders a true empty state when the latest season has no matches', async () => {
    findMatchesMock.mockResolvedValue([]);

    render(await HomePage());

    expect(screen.getByText('No fixtures yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('distinguishes database failures from a true empty season', async () => {
    findCompetitionMock.mockRejectedValue(new Error('database unavailable'));

    render(await HomePage());

    expect(screen.getByRole('alert')).toHaveTextContent('Scores temporarily unavailable');
    expect(screen.queryByText('No fixtures yet')).not.toBeInTheDocument();
  });
});
