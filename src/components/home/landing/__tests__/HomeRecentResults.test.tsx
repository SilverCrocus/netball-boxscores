import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HomeResultCard, HomeResultGroup } from '@/lib/home-feed';
import { HomeRecentResults } from '../HomeRecentResults';

function result(id: string, scheduledAt: string, href?: string): HomeResultCard {
  return {
    id,
    competitionId: href ? undefined : 'glasgow-2026',
    ...(href ? { href } : {}),
    status: 'COMPLETED',
    scoreAvailable: true,
    scheduledAt,
    homeScore: 60,
    awayScore: 55,
    venue: 'The Hydro',
    round: null,
    roundLabel: null,
    stageName: 'Pool Stage',
    finalCode: null,
    homeTeam: { name: `Home ${id}`, abbreviation: 'HOM', logoUrl: null },
    awayTeam: { name: `Away ${id}`, abbreviation: 'AWA', logoUrl: null },
    homeBreakdown: null,
    awayBreakdown: null,
  };
}

describe('HomeRecentResults', () => {
  it('renders the newest five results globally and preserves explicit links', () => {
    const groups: HomeResultGroup[] = [{
      label: 'Pool A',
      matches: [
        result('third', '2026-07-30T13:00:00.000Z'),
        result('oldest', '2026-07-30T08:00:00.000Z'),
        result('newest', '2026-07-30T20:00:00.000Z', 'https://centrepass.example/match/newest'),
      ],
    }, {
      label: 'Pool B',
      matches: [
        result('sixth', '2026-07-30T09:00:00.000Z'),
        result('second', '2026-07-30T18:00:00.000Z'),
        result('fifth', '2026-07-30T10:00:00.000Z'),
        result('fourth', '2026-07-30T12:00:00.000Z'),
      ],
    }];

    render(<HomeRecentResults groups={groups} timezone="Europe/London" />);

    const links = within(screen.getByRole('list', { name: 'Recent results' }))
      .getAllByRole('link');
    expect(links).toHaveLength(5);
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      expect.stringContaining('Home newest 60, Away newest 55'),
      expect.stringContaining('Home second 60, Away second 55'),
      expect.stringContaining('Home third 60, Away third 55'),
      expect.stringContaining('Home fourth 60, Away fourth 55'),
      expect.stringContaining('Home fifth 60, Away fifth 55'),
    ]);
    expect(links[0]).toHaveAttribute('href', 'https://centrepass.example/match/newest');
    expect(screen.queryByText('Home sixth')).not.toBeInTheDocument();
    expect(screen.queryByText('Home oldest')).not.toBeInTheDocument();
  });

  it('renders nothing when no governed completed results are available', () => {
    const { container } = render(<HomeRecentResults groups={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
