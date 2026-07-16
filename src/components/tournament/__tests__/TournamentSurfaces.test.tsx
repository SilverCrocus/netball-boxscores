import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TournamentBracket } from '@/components/tournament/TournamentBracket';
import { TournamentPools } from '@/components/tournament/TournamentPools';
import { TournamentStandings } from '@/components/tournament/TournamentStandings';
import type {
  TournamentBracketStage,
  TournamentPool,
  TournamentPoolStandings,
  TournamentTeam,
} from '@/lib/tournament/types';

function team(pool: 'a' | 'b', seed: number): TournamentTeam {
  const abbreviation = `${pool.toUpperCase()}${seed}`;
  return {
    entryId: `entry-${pool}-${seed}`,
    teamId: `team-${pool}-${seed}`,
    name: `Team ${abbreviation}`,
    displayName: seed === 1 && pool === 'a' ? 'Australia' : `Team ${abbreviation}`,
    slug: `team-${pool}-${seed}`,
    abbreviation,
    logoUrl: null,
    seed,
  };
}

const pools: TournamentPool[] = [
  {
    id: 'pool-a',
    slug: 'pool-a',
    name: 'Pool A',
    sequence: 1,
    teams: Array.from({ length: 6 }, (_, index) => team('a', index + 1)),
  },
  {
    id: 'pool-b',
    slug: 'pool-b',
    name: 'Pool B',
    sequence: 2,
    teams: Array.from({ length: 6 }, (_, index) => team('b', index + 7)),
  },
];

describe('tournament surfaces', () => {
  it('renders both six-team pools accessibly', () => {
    render(<TournamentPools pools={pools} />);

    const poolA = screen.getByRole('region', { name: 'Pool A' });
    const poolB = screen.getByRole('region', { name: 'Pool B' });
    expect(within(poolA).getAllByRole('listitem')).toHaveLength(6);
    expect(within(poolB).getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByText('Australia')).toBeInTheDocument();
  });

  it('explains the pre-event state and renders no zero statistics', () => {
    const standingsPools: TournamentPoolStandings[] = pools.map((pool) => ({
      ...pool,
      hasStandings: false,
      rows: pool.teams.map((entry) => ({ ...entry, standing: null })),
    }));

    render(<TournamentStandings pools={standingsPools} hasAnyStandings={false} />);

    expect(screen.getByRole('status')).toHaveTextContent('No official pool results have been recorded yet');
    expect(screen.getAllByText('Pre-event')).toHaveLength(2);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });

  it('shows qualification labels without dummy teams or scheduled scores', () => {
    const stages: TournamentBracketStage[] = [
      {
        id: 'classification',
        slug: 'classification',
        name: 'Classification Matches',
        type: 'CLASSIFICATION',
        sequence: 2,
        matches: [{
          id: 'classification-1',
          label: 'Classification Match 1 — 11th v 12th',
          scheduledAt: '2026-07-31T08:00:00.000Z',
          venue: 'The Hydro',
          status: 'SCHEDULED',
          sideA: { side: 'A', label: '11th place after pool stage', resolved: false, team: null, score: null },
          sideB: { side: 'B', label: '12th place after pool stage', resolved: false, team: null, score: null },
        }],
      },
      {
        id: 'semi-finals',
        slug: 'semi-finals',
        name: 'Semi-finals',
        type: 'SEMI_FINALS',
        sequence: 3,
        matches: [{
          id: 'semi-final-1',
          label: 'Semi-final 1',
          scheduledAt: '2026-08-01T08:00:00.000Z',
          venue: 'The Hydro',
          status: 'SCHEDULED',
          sideA: { side: 'A', label: 'Semi-finalist TBC', resolved: false, team: null, score: null },
          sideB: { side: 'B', label: 'Semi-finalist TBC', resolved: false, team: null, score: null },
        }],
      },
      {
        id: 'medals',
        slug: 'medal-matches',
        name: 'Medal Matches',
        type: 'MEDAL_MATCHES',
        sequence: 4,
        matches: [
          {
            id: 'bronze',
            label: 'Bronze medal match',
            scheduledAt: '2026-08-02T08:00:00.000Z',
            venue: 'The Hydro',
            status: 'SCHEDULED',
            sideA: { side: 'A', label: 'Loser of Semi-final 1', resolved: false, team: null, score: null },
            sideB: { side: 'B', label: 'Loser of Semi-final 2', resolved: false, team: null, score: null },
          },
          {
            id: 'gold',
            label: 'Gold medal match',
            scheduledAt: '2026-08-02T12:00:00.000Z',
            venue: 'The Hydro',
            status: 'SCHEDULED',
            sideA: { side: 'A', label: 'Winner of Semi-final 1', resolved: false, team: null, score: null },
            sideB: { side: 'B', label: 'Winner of Semi-final 2', resolved: false, team: null, score: null },
          },
        ],
      },
    ];

    render(<TournamentBracket stages={stages} sourceTimezone="Europe/London" />);

    expect(screen.getByText('11th place after pool stage')).toBeInTheDocument();
    expect(screen.getByText('Loser of Semi-final 1')).toBeInTheDocument();
    expect(screen.getByText('Loser of Semi-final 2')).toBeInTheDocument();
    expect(screen.getByText('Winner of Semi-final 1')).toBeInTheDocument();
    expect(screen.getByText('Winner of Semi-final 2')).toBeInTheDocument();
    expect(screen.queryByText(/^TBC$/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/goals$/)).not.toBeInTheDocument();
  });
});
