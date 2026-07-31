import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomeStandingsPreview } from '../HomeStandingsPreview';

describe('HomeStandingsPreview', () => {
  it('keeps a compact table for league standings and preserves unavailable values', () => {
    render(
      <HomeStandingsPreview
        title="Standings"
        rows={[{
          id: 'standing-vixens',
          position: 1,
          team: { name: 'Melbourne Vixens', abbreviation: 'VIX', logoUrl: null },
          played: 14,
          won: 12,
          lost: 2,
          goalDifference: null,
          points: 48,
        }]}
        fullStandingsLink={{ label: 'View full standings', href: '/standings' }}
        note="Official competition standings."
      />,
    );

    expect(screen.getByRole('table', { name: 'Standings' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /Melbourne Vixens/i })).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View full standings' })).toHaveAttribute(
      'href',
      '/standings',
    );
    expect(screen.getByRole('link', { name: 'View full standings' }))
      .toHaveAccessibleName('View full standings');
  });
});
