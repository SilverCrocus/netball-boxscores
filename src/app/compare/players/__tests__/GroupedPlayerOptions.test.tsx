import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GroupedPlayerOptions, groupPlayersByTeam } from '../GroupedPlayerOptions';

const players = [
  { id: 'swift-2', name: 'Zoe Swift', position: 'C', team: { name: 'NSW Swifts' } },
  { id: 'vixen-1', name: 'Maya Vixen', position: 'GD', team: { name: 'Melbourne Vixens' } },
  { id: 'swift-1', name: 'Amy Swift', position: 'GA', team: { name: 'NSW Swifts' } },
];

describe('GroupedPlayerOptions', () => {
  it('groups teams and players alphabetically', () => {
    expect(groupPlayersByTeam(players)).toEqual([
      {
        teamName: 'Melbourne Vixens',
        players: [players[1]],
      },
      {
        teamName: 'NSW Swifts',
        players: [players[2], players[0]],
      },
    ]);
  });

  it('renders team-labelled option groups in a native select', () => {
    const { container } = render(
      <select aria-label="Player one">
        <GroupedPlayerOptions players={players} />
      </select>,
    );

    const groups = [...container.querySelectorAll('optgroup')];
    expect(groups.map((group) => group.label)).toEqual([
      'Melbourne Vixens (1)',
      'NSW Swifts (2)',
    ]);
    expect([...groups[1].querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Amy Swift · GA',
      'Zoe Swift · C',
    ]);
  });
});
