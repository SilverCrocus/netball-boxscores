import { render, screen } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { CompetitionNavigationOption } from '@/lib/competitions';
import StandingsPage, { selectStandingsCompetition } from '../page';

const { competitionFindManyMock, standingFindManyMock } = vi.hoisted(() => ({
  competitionFindManyMock: vi.fn(),
  standingFindManyMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    competition: {
      findMany: competitionFindManyMock,
    },
    standing: {
      findMany: standingFindManyMock,
    },
  },
}));

const competitionFixture = {
  id: 'competition-2026',
  season: 2026,
  name: 'Suncorp Super Netball',
  slug: '2026',
  publicationStatus: 'PUBLISHED',
  series: { id: 'ssn', slug: 'ssn', name: 'Suncorp Super Netball', kind: 'LEAGUE' },
  _count: { entries: 8, matches: 56 },
  seasonStart: new Date('2026-03-01T00:00:00Z'),
  seasonEnd: new Date('2026-07-31T00:00:00Z'),
};

const standingsFixture = [
  {
    id: '1',
    rank: 1,
    played: 12,
    wins: 11,
    losses: 1,
    draws: 0,
    goalsFor: 645,
    goalsAgainst: 412,
    goalPercentage: 156.5,
    points: 44,
    team: { name: 'Vipers Athletics', slug: 'vipers-athletics', abbreviation: 'VIP', logoUrl: null },
  },
  {
    id: '2',
    rank: 2,
    played: 12,
    wins: 10,
    losses: 2,
    draws: 0,
    goalsFor: 598,
    goalsAgainst: 480,
    goalPercentage: 124.5,
    points: 40,
    team: { name: 'Starlight Gems', slug: 'starlight-gems', abbreviation: 'STA', logoUrl: null },
  },
];

beforeEach(() => {
  competitionFindManyMock.mockReset().mockResolvedValue([competitionFixture]);
  standingFindManyMock.mockReset().mockResolvedValue(standingsFixture);
});

describe('selectStandingsCompetition', () => {
  const option = (id: string, season: number, kind: 'LEAGUE' | 'TOURNAMENT' = 'LEAGUE') => ({
    ...competitionFixture,
    id,
    season,
    series: { ...competitionFixture.series, kind },
  }) as unknown as CompetitionNavigationOption;

  it('keeps exact edition selection and filters legacy selectors to leagues', () => {
    const competitions = [option('league-2026', 2026), option('cup-2026', 2026, 'TOURNAMENT'), option('league-2025', 2025)];

    expect(selectStandingsCompetition(competitions, { edition: 'cup-2026' })).toMatchObject({
      competition: { id: 'cup-2026' },
      competitions,
    });
    expect(selectStandingsCompetition(competitions, {}).competitions.map(({ id }) => id)).toEqual([
      'league-2026', 'league-2025',
    ]);
  });

  it('preserves legacy season matching and latest fallback', () => {
    const competitions = [option('league-2026', 2026), option('league-2025', 2025)];

    expect(selectStandingsCompetition(competitions, { season: '2025' }).competition?.id).toBe('league-2025');
    expect(selectStandingsCompetition(competitions, { season: 'not-a-year' }).competition?.id).toBe('league-2026');
  });
});

describe('StandingsPage', () => {
  const props = { searchParams: Promise.resolve({}) };

  it('uses the compact navigation projection for fresh competition selection', async () => {
    await StandingsPage(props);

    expect(competitionFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        id: true,
        season: true,
        series: expect.any(Object),
      }),
    }));
    expect(competitionFindManyMock.mock.calls[0]?.[0]?.select).not.toHaveProperty('ruleset');
    expect(competitionFindManyMock.mock.calls[0]?.[0]?.select).not.toHaveProperty('dataCoverage');
  });

  it('renders standings heading', async () => {
    const page = await StandingsPage(props);
    render(page);
    expect(screen.getByText(/Standings/i)).toBeInTheDocument();
  });

  it('renders team names', async () => {
    const page = await StandingsPage(props);
    render(page);
    expect(screen.getAllByText('Vipers Athletics')).toHaveLength(2);
    expect(screen.getAllByText('Starlight Gems')).toHaveLength(2);
  });

  it('renders column headers', async () => {
    const page = await StandingsPage(props);
    render(page);
    expect(screen.getByText('GP')).toBeInTheDocument();
    expect(screen.getAllByText('Pts')).toHaveLength(3);
  });

  it('adds explanatory tooltips to column headers', async () => {
    const page = await StandingsPage(props);
    render(page);
    expect(screen.getByTitle('Games Played')).toHaveTextContent('GP');
    expect(screen.getByTitle(/Goal Percentage/)).toHaveTextContent(
      'G%',
    );
    expect(screen.getByTitle(/4 for a win/)).toHaveTextContent(
      'Pts',
    );
  });

  it('renders points values', async () => {
    const page = await StandingsPage(props);
    render(page);
    expect(screen.getAllByText('44')).toHaveLength(2);
    expect(screen.getAllByText('40')).toHaveLength(2);
  });
});
