import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  HomeUpcomingFixtures,
  type HomeUpcomingFixture,
} from '../HomeUpcomingFixtures';

function fixture(index: number): HomeUpcomingFixture {
  return {
    id: `fixture-${index}`,
    href: `/match/fixture-${index}`,
    dateLabel: `Sat ${index} Aug`,
    timeLabel: '7:00 pm',
    venueLabel: 'The Hydro',
    homeTeam: { name: `Home ${index}`, abbreviation: `H${index}`, logoUrl: null },
    awayTeam: { name: `Away ${index}`, abbreviation: `A${index}`, logoUrl: null },
  };
}

describe('HomeUpcomingFixtures', () => {
  it('keeps the section and all-fixtures link visible when no teams are confirmed', () => {
    render(
      <HomeUpcomingFixtures
        title="Upcoming fixtures"
        fixtures={[]}
        allFixturesLink={{ label: 'View all fixtures', href: '/fixtures' }}
        emptyMessage="Knockout fixtures will appear here as soon as both teams are confirmed."
      />,
    );

    expect(screen.getByRole('heading', { name: 'Upcoming fixtures' })).toBeInTheDocument();
    expect(screen.getByText(
      'Knockout fixtures will appear here as soon as both teams are confirmed.',
    )).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all fixtures' })).toHaveAttribute(
      'href',
      '/fixtures',
    );
    expect(screen.queryByText('TBD')).not.toBeInTheDocument();
  });

  it('renders at most five confirmed fixture rows', () => {
    render(
      <HomeUpcomingFixtures
        title="Upcoming fixtures"
        fixtures={Array.from({ length: 6 }, (_, index) => fixture(index + 1))}
        allFixturesLink={{ label: 'View all fixtures', href: '/fixtures' }}
      />,
    );

    const fixtureLinks = within(screen.getByRole('list')).getAllByRole('link');
    expect(fixtureLinks).toHaveLength(5);
    expect(fixtureLinks[0]).toHaveAccessibleName(/Home 1 versus Away 1/);
    expect(screen.queryByText('Home 6')).not.toBeInTheDocument();
  });
});
