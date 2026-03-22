import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NetballCourt } from '../NetballCourt';

const mockHomePlayers = [
  { id: '1', name: 'Player A', position: 'GS' as const, teamId: 'home' },
  { id: '2', name: 'Player B', position: 'GA' as const, teamId: 'home' },
  { id: '3', name: 'Player C', position: 'WA' as const, teamId: 'home' },
  { id: '4', name: 'Player D', position: 'C' as const, teamId: 'home' },
  { id: '5', name: 'Player E', position: 'WD' as const, teamId: 'home' },
  { id: '6', name: 'Player F', position: 'GD' as const, teamId: 'home' },
  { id: '7', name: 'Player G', position: 'GK' as const, teamId: 'home' },
];

const mockAwayPlayers = [
  { id: '8', name: 'Player H', position: 'GS' as const, teamId: 'away' },
  { id: '9', name: 'Player I', position: 'GA' as const, teamId: 'away' },
  { id: '10', name: 'Player J', position: 'WA' as const, teamId: 'away' },
  { id: '11', name: 'Player K', position: 'C' as const, teamId: 'away' },
  { id: '12', name: 'Player L', position: 'WD' as const, teamId: 'away' },
  { id: '13', name: 'Player M', position: 'GD' as const, teamId: 'away' },
  { id: '14', name: 'Player N', position: 'GK' as const, teamId: 'away' },
];

describe('NetballCourt', () => {
  it('should render 14 player nodes (7 per team)', () => {
    const { container } = render(
      <NetballCourt homePlayers={mockHomePlayers} awayPlayers={mockAwayPlayers} />
    );
    const playerNodes = container.querySelectorAll('[data-testid^="player-node"]');
    expect(playerNodes).toHaveLength(14);
  });

  it('should render court lines (thirds, centre circle, shooting circles)', () => {
    const { container } = render(
      <NetballCourt homePlayers={mockHomePlayers} awayPlayers={mockAwayPlayers} />
    );
    expect(container.querySelector('[data-testid="thirds-line-1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="thirds-line-2"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="centre-circle"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="shooting-circle-top"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="shooting-circle-bottom"]')).toBeTruthy();
  });

  it('should display position abbreviations in nodes', () => {
    render(
      <NetballCourt homePlayers={mockHomePlayers} awayPlayers={mockAwayPlayers} />
    );
    expect(screen.getAllByText('GS')).toHaveLength(2);
    expect(screen.getAllByText('GK')).toHaveLength(2);
  });
});
