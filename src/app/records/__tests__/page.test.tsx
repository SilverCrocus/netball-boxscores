import { createElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAnalyticsEditions: vi.fn(),
  getRecordSnapshot: vi.fn(),
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
vi.mock('@/lib/records/service', () => ({ getRecordSnapshot: mocks.getRecordSnapshot }));

import RecordsPage from '../page';

const edition = {
  id: 'edition-1',
  season: 2026,
  label: null,
  slug: '2026',
  series: { name: 'SSN', slug: 'ssn', id: 'series-1', kind: 'LEAGUE' },
};

describe('RecordsPage dense links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAnalyticsEditions.mockResolvedValue([edition]);
    mocks.getRecordSnapshot.mockResolvedValue({
      methodVersion: 'centrepass-records.v1',
      request: {},
      asOf: '2026-07-01T00:00:00.000Z',
      coverageLabel: 'Verified coverage',
      entries: [{
        entityType: 'PLAYER',
        entity: { id: 'player-1', name: 'Player One', position: 'GS', teamName: 'Team One' },
        supportingCompetitionId: edition.id,
        supportingMatchId: 'match-1',
        value: 62,
        unit: 'COUNT',
        games: 1,
        minutes: 60,
        achievedAt: '2026-07-01T00:00:00.000Z',
        status: 'CONFIRMED',
        formulaVersion: 'goals.v1',
        source: { policy: 'Official', note: 'Verified' },
      }],
    });
  });

  it('disables viewport prefetch for entity and supporting-match result links', async () => {
    render(await RecordsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('link', { name: 'Player One' })).toHaveAttribute('data-prefetch', 'false');
    expect(screen.getByRole('link', { name: 'Supporting match' })).toHaveAttribute('data-prefetch', 'false');
    expect(mocks.getRecordSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ competitionId: edition.id }),
      { editions: [edition] },
    );
  });
});
