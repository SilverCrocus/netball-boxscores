import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EditionTeamsPage from '../page';
import { resolveEdition } from '@/lib/competitions';
import { getEditionTeams } from '@/lib/edition-teams';

vi.mock('@/lib/competitions', () => ({ resolveEdition: vi.fn() }));
vi.mock('@/lib/edition-teams', () => ({ getEditionTeams: vi.fn() }));

const edition = {
  id: 'glasgow-2026',
  season: 2026,
  name: 'Commonwealth Games Netball',
  slug: 'glasgow-2026',
  label: 'Glasgow 2026',
  sourceTimezone: 'Europe/London',
  publicationStatus: 'PUBLISHED',
  series: {
    id: 'cwg',
    slug: 'commonwealth-games',
    name: 'Commonwealth Games Netball',
    kind: 'TOURNAMENT',
  },
  _count: { entries: 12, matches: 38 },
};

describe('EditionTeamsPage', () => {
  beforeEach(() => {
    vi.mocked(resolveEdition).mockResolvedValue({
      edition: edition as never,
      editions: [edition as never],
    });
    vi.mocked(getEditionTeams).mockResolvedValue([
      {
        entryId: 'australia-entry',
        displayName: 'Australia',
        seed: 1,
        poolName: 'Pool A',
        rosterCount: 12,
        team: {
          id: 'australia',
          name: 'Australia',
          slug: 'australia',
          abbreviation: 'AUS',
          logoUrl: null,
        },
      },
      {
        entryId: 'malawi-entry',
        displayName: 'Malawi',
        seed: 5,
        poolName: 'Pool B',
        rosterCount: 0,
        team: {
          id: 'malawi',
          name: 'Malawi',
          slug: 'malawi',
          abbreviation: 'MAW',
          logoUrl: null,
        },
      },
    ]);
  });

  it('renders the selected edition participants and honest squad coverage', async () => {
    const page = await EditionTeamsPage({
      params: Promise.resolve({
        competitionSlug: 'commonwealth-games',
        editionSlug: 'glasgow-2026',
      }),
    });
    render(page);

    expect(getEditionTeams).toHaveBeenCalledWith('glasgow-2026');
    expect(screen.getByRole('heading', { level: 2, name: 'Teams' })).toBeInTheDocument();
    expect(screen.getByText('Australia')).toBeInTheDocument();
    expect(screen.getByText('12 squad players available')).toBeInTheDocument();
    expect(screen.getByText('Squad awaiting publication')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Australia/ })).toHaveAttribute(
      'href',
      '/team/australia?edition=glasgow-2026',
    );
  });
});
