import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TeamsPage from '../page';

vi.mock('@/lib/db', () => ({
  prisma: {
    competition: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'competition-2026',
          season: 2026,
          name: 'Suncorp Super Netball',
          slug: '2026',
          publicationStatus: 'PUBLISHED',
          series: { id: 'ssn', slug: 'ssn', name: 'Suncorp Super Netball', kind: 'LEAGUE' },
          _count: { entries: 8, matches: 56 },
        },
      ]),
    },
    team: {
      findMany: vi.fn().mockResolvedValue([
        { id: '1', name: 'Melbourne Vixens', slug: 'melbourne-vixens', abbreviation: 'VIX', logoUrl: null, primaryColor: '#FF0090' },
        { id: '2', name: 'West Coast Fever', slug: 'west-coast-fever', abbreviation: 'FEV', logoUrl: null, primaryColor: '#00B140' },
        { id: '3', name: 'Queensland Firebirds', slug: 'queensland-firebirds', abbreviation: 'FIR', logoUrl: null, primaryColor: '#FF6B00' },
      ]),
    },
  },
}));

describe('TeamsPage', () => {
  it('renders heading', async () => {
    const page = await TeamsPage();
    render(page);
    expect(screen.getByRole('heading', { level: 1, name: /Teams/i })).toBeInTheDocument();
  });

  it('renders all team names', async () => {
    const page = await TeamsPage();
    render(page);
    expect(screen.getByText('Melbourne Vixens')).toBeInTheDocument();
    expect(screen.getByText('West Coast Fever')).toBeInTheDocument();
    expect(screen.getByText('Queensland Firebirds')).toBeInTheDocument();
  });

  it('renders team cards as links', async () => {
    const page = await TeamsPage();
    render(page);
    const links = screen.getAllByRole('link');
    expect(links.some((l) => l.getAttribute('href') === '/team/melbourne-vixens')).toBe(true);
  });
});
