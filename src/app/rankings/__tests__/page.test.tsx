import { createElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAnalyticsEditions: vi.fn(),
  getPlayerRankingSnapshot: vi.fn(),
  getTeamPowerSnapshot: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ href, prefetch, children, ...props }: {
    href: string;
    prefetch?: boolean;
    children: ReactNode;
    className?: string;
  }) => createElement(
    'a',
    { ...props, href, 'data-prefetch': prefetch === false ? 'false' : 'default' },
    children,
  ),
}));
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('@/lib/server-feature-flags', () => ({ analyticsFeaturesEnabled: () => true }));
vi.mock('@/lib/analytics/repository', () => ({ listAnalyticsEditions: mocks.listAnalyticsEditions }));
vi.mock('@/lib/rankings/service', () => ({
  getPlayerRankingSnapshot: mocks.getPlayerRankingSnapshot,
  getTeamPowerSnapshot: mocks.getTeamPowerSnapshot,
}));

import RankingsPage from '../page';

const edition = {
  id: 'edition-1',
  season: 2026,
  label: null,
  slug: '2026',
  series: { name: 'SSN', slug: 'ssn', id: 'series-1', kind: 'LEAGUE' },
};

describe('RankingsPage dense links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAnalyticsEditions.mockResolvedValue([edition]);
  });

  it('disables viewport prefetch for player result rows while retaining ranking tabs', async () => {
    mocks.getPlayerRankingSnapshot.mockResolvedValue({
      request: { competitionId: edition.id, metricId: 'centrepass_impact' },
      methodVersion: 'rankings.v1',
      formulaVersion: 'centrepass-impact.v1',
      populationSize: 1,
      asOf: null,
      entries: [{
        rank: 1,
        percentile: 90,
        movementLabel: 'New',
        entity: { id: 'player-1', name: 'Player One', position: 'C', teamName: 'Team One' },
        result: { value: 12.3, unit: 'POINTS', games: 3, minutes: 180, coverage: 'AVAILABLE' },
      }],
    });

    render(await RankingsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('link', { name: 'Player rankings' })).toHaveAttribute('data-prefetch', 'default');
    expect(screen.getByRole('link', { name: 'Player One' })).toHaveAttribute('data-prefetch', 'false');
  });

  it('disables viewport prefetch for team result rows', async () => {
    mocks.getTeamPowerSnapshot.mockResolvedValue({
      methodVersion: 'team-power.v1',
      populationSize: 1,
      asOf: null,
      entries: [{
        rank: 1,
        percentile: 90,
        movementLabel: 'New',
        entity: { id: 'team-1', slug: 'team-one', name: 'Team One' },
        rating: 101.2,
        wins: 2,
        losses: 0,
        draws: 0,
        games: 2,
        includedMatchIds: ['match-1'],
        coverage: 'AVAILABLE',
      }],
    });

    render(await RankingsPage({ searchParams: Promise.resolve({ view: 'teams' }) }));

    expect(screen.getByRole('link', { name: 'Team power' })).toHaveAttribute('data-prefetch', 'default');
    expect(screen.getByRole('link', { name: 'Team One' })).toHaveAttribute('data-prefetch', 'false');
  });
});
