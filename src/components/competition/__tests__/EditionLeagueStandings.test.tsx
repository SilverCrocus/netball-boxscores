import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditionLeagueStandings } from '@/components/competition/EditionLeagueStandings';

describe('EditionLeagueStandings', () => {
  it('renders the league ladder with canonical edition links', () => {
    render(
      <EditionLeagueStandings
        competitionId="ssn-2026"
        editionLabel="2026"
        standings={[{
          id: 'standing-1',
          rank: 1,
          played: 14,
          wins: 12,
          losses: 2,
          draws: 0,
          goalsFor: 850,
          goalsAgainst: 720,
          goalPercentage: 118.1,
          points: 48,
          team: {
            name: 'Adelaide Thunderbirds',
            slug: 'adelaide-thunderbirds',
            abbreviation: 'THU',
            logoUrl: null,
          },
        }]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'League Standings' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Adelaide Thunderbirds/ })[0]).toHaveAttribute(
      'href',
      '/team/adelaide-thunderbirds?edition=ssn-2026',
    );
    expect(screen.getAllByText('48')).toHaveLength(2);
  });
});
