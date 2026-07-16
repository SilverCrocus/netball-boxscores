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
          photoSourceUrl: null,
          photoCredit: null,
          photoLicense: null,
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

  it('shows reusable-photo credit, source, and licence links on the player profile', () => {
    render(
      <PlayerHero
        player={{
          name: 'Funmi Fadoju',
          position: 'GD',
          photoUrl: 'https://upload.wikimedia.org/example.jpg',
          photoSourceUrl: 'https://commons.wikimedia.org/wiki/File:England_Netball_player_Funmi_Fadoju.jpg',
          photoCredit: 'Amy Martin Photography',
          photoLicense: 'CC BY-SA 4.0',
          nationality: 'England',
          dateOfBirth: null,
          height: null,
          teamId: 'team-1',
          team: {
            name: 'England',
            slug: 'england-glasgow-2026',
            logoUrl: null,
            primaryColor: '#ef4444',
          },
        }}
        positionConfig={positionConfig}
        statHighlightValues={[0, 0, 0]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Amy Martin Photography' })).toHaveAttribute(
      'href',
      'https://commons.wikimedia.org/wiki/File:England_Netball_player_Funmi_Fadoju.jpg',
    );
    expect(screen.getByRole('link', { name: 'CC BY-SA 4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by-sa/4.0/',
    );
    expect(screen.getByText(/cropped for display/)).toBeInTheDocument();
  });

  it('renders unavailable highlights without manufacturing zero values', () => {
    render(
      <PlayerHero
        player={{
          name: 'Example Player',
          position: 'GS',
          photoUrl: null,
          photoSourceUrl: null,
          photoCredit: null,
          photoLicense: null,
          nationality: null,
          dateOfBirth: null,
          height: null,
          teamId: 'team-1',
          team: {
            name: 'Example Team',
            slug: 'example-team',
            logoUrl: null,
            primaryColor: null,
          },
        }}
        positionConfig={positionConfig}
        statHighlightValues={[null, null, null]}
      />,
    );

    expect(screen.getByLabelText('Goals Scored unavailable')).toHaveTextContent('—');
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
