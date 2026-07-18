import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EditionPage from '../page';
import { resolveEdition } from '@/lib/competitions';
import { getEditionSchedule, type EditionSchedule } from '@/lib/edition-schedule';

vi.mock('@/lib/competitions', () => ({ resolveEdition: vi.fn() }));
vi.mock('@/lib/edition-schedule', () => ({ getEditionSchedule: vi.fn() }));

const edition = {
  id: 'glasgow-2026',
  season: 2026,
  name: 'Commonwealth Games Netball',
  slug: 'glasgow-2026',
  label: 'Glasgow 2026',
  sourceTimezone: 'Europe/London',
  publicationStatus: 'PUBLISHED',
  series: { id: 'cwg', slug: 'commonwealth-games', name: 'Commonwealth Games Netball', kind: 'TOURNAMENT' },
  _count: { entries: 12, matches: 38 },
};

const schedule: EditionSchedule = {
  editionId: 'glasgow-2026',
  competitionName: 'Commonwealth Games Netball',
  editionLabel: 'Glasgow 2026',
  competitionKind: 'TOURNAMENT',
  sourceTimezone: 'Europe/London',
  timezoneLabel: 'BST',
  summary: {
    fixtureCount: 38,
    teamCount: 12,
    stageCount: 4,
    scheduledCount: 38,
    liveCount: 0,
    completedCount: 0,
    dateRangeLabel: '25 Jul 2026 – 2 Aug 2026',
  },
  stages: [],
};

describe('EditionPage', () => {
  beforeEach(() => {
    vi.mocked(resolveEdition).mockResolvedValue({
      edition: edition as never,
      editions: [edition as never],
    });
    vi.mocked(getEditionSchedule).mockResolvedValue(schedule);
  });

  it('resolves the exact edition and renders its schedule summary', async () => {
    const page = await EditionPage({
      params: Promise.resolve({
        competitionSlug: 'commonwealth-games',
        editionSlug: 'glasgow-2026',
      }),
    });
    render(page);

    expect(resolveEdition).toHaveBeenCalledWith({
      competitionSlug: 'commonwealth-games',
      editionSlug: 'glasgow-2026',
    });
    expect(getEditionSchedule).toHaveBeenCalledWith(edition);
    expect(screen.getByRole('heading', { name: 'Commonwealth Games Netball' })).toBeInTheDocument();
    expect(screen.getByText('38')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Schedule awaiting publication')).toBeInTheDocument();
  });
});
