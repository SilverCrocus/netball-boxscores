import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TournamentStandingsPage from '../page';
import { resolveEdition } from '@/lib/competitions';
import { getTournamentPoolStandings } from '@/lib/tournament';

const { measureServerOperationMock } = vi.hoisted(() => ({
  measureServerOperationMock: vi.fn(
    (_route: string, _operation: string, handler: () => Promise<unknown>) => handler(),
  ),
}));

vi.mock('@/lib/competitions', () => ({ resolveEdition: vi.fn() }));
vi.mock('@/lib/tournament', () => ({ getTournamentPoolStandings: vi.fn() }));
vi.mock('@/lib/cached-queries', () => ({ getStandingsForCompetition: vi.fn() }));
vi.mock('@/lib/server-timing', () => ({ measureServerOperation: measureServerOperationMock }));

const edition = {
  id: 'glasgow-2026',
  season: 2026,
  name: 'Commonwealth Games Netball',
  slug: 'glasgow-2026',
  label: 'Glasgow 2026',
  sourceTimezone: 'Europe/London',
  publicationStatus: 'PUBLISHED',
  series: {
    id: 'commonwealth-games-netball',
    slug: 'commonwealth-games-netball',
    name: 'Commonwealth Games Netball',
    kind: 'TOURNAMENT',
  },
  _count: { entries: 12, matches: 38 },
};

const overview = {
  stageId: 'pool-stage',
  stageName: 'Pool Stage',
  hasAnyStandings: false,
  pools: [{
    id: 'pool-a',
    slug: 'pool-a',
    name: 'Pool A',
    sequence: 1,
    hasStandings: false,
    rows: [{
      entryId: 'entry-aus',
      teamId: 'team-aus',
      name: 'Australia',
      displayName: 'Australia',
      slug: 'australia',
      abbreviation: 'AUS',
      logoUrl: null,
      seed: 1,
      standing: null,
    }],
  }],
};

describe('canonical tournament standings page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveEdition).mockResolvedValue({
      edition: edition as never,
      editions: [edition as never],
    });
    vi.mocked(getTournamentPoolStandings).mockResolvedValue(overview);
  });

  it('freshly resolves publication/readiness before reading cached pool standings', async () => {
    const order: string[] = [];
    vi.mocked(resolveEdition).mockImplementation(async () => {
      order.push('resolve-edition');
      return { edition: edition as never, editions: [edition as never] };
    });
    vi.mocked(getTournamentPoolStandings).mockImplementation(async () => {
      order.push('pool-standings');
      return overview;
    });

    const page = await TournamentStandingsPage({
      params: Promise.resolve({
        competitionSlug: 'commonwealth-games-netball',
        editionSlug: 'glasgow-2026',
      }),
    });
    render(page);

    expect(order).toEqual(['resolve-edition', 'pool-standings']);
    expect(getTournamentPoolStandings).toHaveBeenCalledWith('glasgow-2026');
    expect(measureServerOperationMock).toHaveBeenCalledWith(
      '/competitions/[competitionSlug]/[editionSlug]/standings',
      'tournament-standings-page',
      expect.any(Function),
    );
    expect(screen.getByRole('heading', { name: 'Pool Standings' })).toBeInTheDocument();
    expect(screen.getByText('Australia')).toBeInTheDocument();
  });

  it('keeps the pre-event null standing contract', async () => {
    const page = await TournamentStandingsPage({
      params: Promise.resolve({
        competitionSlug: 'commonwealth-games-netball',
        editionSlug: 'glasgow-2026',
      }),
    });
    render(page);

    expect(screen.getByText('Pre-event table')).toBeInTheDocument();
    expect(screen.getByText('Seed 1')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
