import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PlayerStatsTable } from '../PlayerStatsTable';

const players = [
  {
    id: '1',
    name: 'Elena Rodriguez',
    position: 'GS' as const,
    photoUrl: null,
    goals: 42,
    attempts: 45,
    goalAssists: 0,
    intercepts: 0,
    deflections: 1,
    rebounds: 4,
    penalties: 0,
    feeds: 2,
    centrePassReceives: 0,
    turnovers: 1,
    minutesPlayed: 60,
  },
  {
    id: '2',
    name: 'Tasha Banks',
    position: 'GK' as const,
    photoUrl: null,
    goals: 0,
    attempts: 0,
    goalAssists: 0,
    intercepts: 8,
    deflections: 12,
    rebounds: 9,
    penalties: 2,
    feeds: 0,
    centrePassReceives: 0,
    turnovers: 0,
    minutesPlayed: 60,
  },
];

describe('PlayerStatsTable', () => {
  it('renders team name in header', () => {
    render(<PlayerStatsTable team={{ name: 'Thunder', abbreviation: 'THU', logoUrl: null }} players={players} />);
    expect(screen.getByText(/THUNDER/i)).toBeInTheDocument();
  });

  it('renders all player names', () => {
    render(<PlayerStatsTable team={{ name: 'Thunder', abbreviation: 'THU', logoUrl: null }} players={players} />);
    expect(screen.getByText('Elena Rodriguez')).toBeInTheDocument();
    expect(screen.getByText('Tasha Banks')).toBeInTheDocument();
  });

  it('renders position badges', () => {
    render(<PlayerStatsTable team={{ name: 'Thunder', abbreviation: 'THU', logoUrl: null }} players={players} />);
    expect(screen.getByText('GS')).toBeInTheDocument();
    expect(screen.getByText('GK')).toBeInTheDocument();
  });

  it('renders goal stats', () => {
    render(<PlayerStatsTable team={{ name: 'Thunder', abbreviation: 'THU', logoUrl: null }} players={players} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders column headers', () => {
    render(<PlayerStatsTable team={{ name: 'Thunder', abbreviation: 'THU', logoUrl: null }} players={players} />);
    expect(screen.getByText('G')).toBeInTheDocument();
    expect(screen.getByText('INT')).toBeInTheDocument();
    expect(screen.getByText('REB')).toBeInTheDocument();
    expect(screen.getByText('AST')).toBeInTheDocument();
    expect(screen.getByText('FD')).toBeInTheDocument();
    expect(screen.getByText('TO')).toBeInTheDocument();
  });
});
