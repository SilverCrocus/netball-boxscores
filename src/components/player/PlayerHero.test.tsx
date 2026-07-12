import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlayerHero } from './PlayerHero';
import type { PositionConfig } from './position-config';

const positionConfig: PositionConfig = {
  group: 'shooter',
  highlights: [
    { key: 'goals', label: 'Goals Scored', statField: 'goals' },
    { key: 'shootingPct', label: 'Shooting %', statField: 'shootingPct', format: 'percentage' },
    { key: 'rebounds', label: 'Rebounds', statField: 'rebounds' },
  ],
  gameLogColumns: [],
  primaryChartStat: 'goals',
  primaryChartLabel: 'Goals',
};

describe('PlayerHero', () => {
  it('keeps long names contained and starts mobile highlights with a full card', () => {
    render(
      <PlayerHero
        player={{
          name: 'Alexandria Verylongsurname-Williams',
          position: 'GS',
          photoUrl: null,
          nationality: 'Australia',
          dateOfBirth: null,
          height: null,
          teamId: 'team-1',
          team: {
            name: 'Manchester Thunder Netball Club',
            slug: 'manchester-thunder',
            logoUrl: null,
            primaryColor: '#a3e635',
          },
        }}
        positionConfig={positionConfig}
        statHighlightValues={[50, 91, 4]}
      />,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('break-words');
    const highlights = screen.getByLabelText('Player highlights');
    expect(highlights).toHaveClass('w-full', 'overflow-x-auto', 'justify-start');
    expect(within(highlights).getByText('Goals Scored').parentElement).toHaveClass(
      'snap-start',
      'min-w-[8.5rem]',
    );
  });
});
