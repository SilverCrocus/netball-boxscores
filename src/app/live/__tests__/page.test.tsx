import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  findManyMock,
  getLiveStateMock,
  redirectMock,
  resolveCompetitionMock,
  resolvePublicMatchBatchMock,
  scoreCardPropsMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  getLiveStateMock: vi.fn(),
  redirectMock: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
  resolveCompetitionMock: vi.fn(),
  resolvePublicMatchBatchMock: vi.fn(),
  scoreCardPropsMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/lib/live-state', () => ({
  getLiveState: getLiveStateMock,
  liveMatchSelect: {},
}));
vi.mock('@/lib/competitions', () => ({
  resolveCompetition: resolveCompetitionMock,
}));
vi.mock('@/lib/db', () => ({
  excludeSimData: { isSimulated: false },
  prisma: {
    match: { findFirst: findFirstMock, findMany: findManyMock },
  },
}));
vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccessBatch: resolvePublicMatchBatchMock,
  canExposePublicMatchScore: (access: { scoreAvailable: boolean }) => access.scoreAvailable,
}));
vi.mock('@/components/ui/ScoreCard', () => ({
  ScoreCard: ({ match }: { match: { id: string } }) => {
    scoreCardPropsMock(match);
    return <div>Card {match.id}</div>;
  },
}));

import LivePage from '../page';

const fixture = {
  id: 'next-match',
  competitionId: 'competition-2026',
  status: 'SCHEDULED',
  resultQuality: 'UNKNOWN',
  scheduledAt: new Date('2026-07-20T04:00:00Z'),
  homeScore: 0,
  awayScore: 0,
  venue: 'Arena',
  round: 14,
  roundLabel: null,
  finalCode: null,
  stage: null,
  currentQuarter: null,
  currentTime: null,
  homeTeamId: 'home',
  awayTeamId: 'away',
  homeTeam: { name: 'Vipers', abbreviation: 'VIP', logoUrl: null },
  awayTeam: { name: 'Stars', abbreviation: 'STA', logoUrl: null },
  competition: {
    dataCoverage: [
      { capability: 'FINAL_SCORE', state: 'AVAILABLE' },
      { capability: 'SUPER_SHOTS', state: 'AVAILABLE' },
    ],
  },
  dataCoverage: [],
  teamStats: [],
};

describe('LivePage', () => {
  beforeEach(() => {
    getLiveStateMock.mockReset();
    redirectMock.mockClear();
    resolveCompetitionMock.mockReset().mockResolvedValue({ competition: { id: 'competition-2026' } });
    findFirstMock.mockReset();
    findManyMock.mockReset();
    scoreCardPropsMock.mockClear();
    resolvePublicMatchBatchMock.mockReset().mockImplementation(async (ids: string[]) => new Map(
      ids.map((id) => [id, {
        status: id === 'latest-result' ? 'COMPLETED' : id.startsWith('live-') ? 'LIVE' : 'SCHEDULED',
        scoreAvailable: id === 'latest-result' || id.startsWith('live-'),
        features: { superShots: { available: true } },
      }]),
    ));
  });

  it('renders a useful hub when no match is live', async () => {
    getLiveStateMock.mockResolvedValue({ liveMatches: [], liveMatchIds: [] });
    findFirstMock.mockImplementation(({ where }: { where: { status: string } }) =>
      Promise.resolve(where.status === 'SCHEDULED'
        ? fixture
        : { ...fixture, id: 'latest-result', status: 'COMPLETED', resultQuality: 'OFFICIAL_FINAL' }),
    );

    render(await LivePage());

    expect(screen.getByRole('heading', { name: 'No match is live right now' })).toBeInTheDocument();
    expect(screen.getByText('Card next-match')).toBeInTheDocument();
    expect(screen.getByText('Card latest-result')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all fixtures' })).toHaveAttribute('href', '/');
    expect(findFirstMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'SCHEDULED',
        OR: [
          { stageId: null },
          { stage: { is: { isPublished: true } } },
        ],
      }),
    }));
    expect(resolveCompetitionMock).toHaveBeenCalledOnce();
    expect(resolvePublicMatchBatchMock).toHaveBeenCalledOnce();
    expect(findFirstMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'COMPLETED',
        OR: [
          { stageId: null },
          { stage: { is: { isPublished: true } } },
        ],
      }),
    }));
  });

  it('fails closed for the fallback score, clock, and super-shot detail', async () => {
    getLiveStateMock.mockResolvedValue({ liveMatches: [], liveMatchIds: [] });
    findFirstMock.mockImplementation(({ where }: { where: { status: string } }) =>
      Promise.resolve(where.status === 'SCHEDULED'
        ? fixture
        : {
            ...fixture,
            id: 'latest-result',
            status: 'COMPLETED',
            resultQuality: 'OFFICIAL_FINAL',
            homeScore: 62,
            awayScore: 58,
            currentQuarter: 4,
            currentTime: '0',
            teamStats: [
              { teamId: 'home', goals: 60, goal2: 2 },
              { teamId: 'away', goals: 58, goal2: 0 },
            ],
          }),
    );
    resolvePublicMatchBatchMock.mockImplementation(async (ids: string[]) => new Map(
      ids.map((id) => [id, {
        status: id === 'latest-result' ? 'COMPLETED' : 'SCHEDULED',
        scoreAvailable: false,
        features: { superShots: { available: false } },
      }]),
    ));

    render(await LivePage());

    const latest = scoreCardPropsMock.mock.calls
      .map(([props]) => props)
      .find((props) => props.id === 'latest-result');
    expect(latest).toMatchObject({
      scoreAvailable: false,
      homeScore: null,
      awayScore: null,
      currentQuarter: null,
      currentTime: null,
      homeBreakdown: null,
      awayBreakdown: null,
    });
  });

  it('offers a chooser when several matches are live', async () => {
    getLiveStateMock.mockResolvedValue({
      liveMatches: [
        { id: 'live-1', competitionId: 'competition-2026' },
        { id: 'live-2', competitionId: 'competition-2026' },
      ],
      liveMatchIds: ['live-1', 'live-2'],
    });
    findManyMock.mockResolvedValue([
      { ...fixture, id: 'live-1', status: 'LIVE' },
      { ...fixture, id: 'live-2', status: 'LIVE' },
    ]);

    render(await LivePage());

    expect(screen.getByRole('heading', { name: 'Choose a live match' })).toBeInTheDocument();
    expect(screen.getByText('Card live-1')).toBeInTheDocument();
    expect(screen.getByText('Card live-2')).toBeInTheDocument();
    expect(resolveCompetitionMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('redirects one public live match to its canonical edition URL', async () => {
    getLiveStateMock.mockResolvedValue({
      liveMatches: [{ id: 'live-1', competitionId: 'ssn-2026' }],
      liveMatchIds: ['live-1'],
    });

    await expect(LivePage()).rejects.toThrow(
      'NEXT_REDIRECT:/match/live-1/live?edition=ssn-2026',
    );
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(resolveCompetitionMock).not.toHaveBeenCalled();
  });
});
