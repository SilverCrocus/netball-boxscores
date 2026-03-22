import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MatchMomentum } from '../MatchMomentum';

const scoreFlow = [
  { period: 1, homeScore: 1, awayScore: 0 },
  { period: 1, homeScore: 2, awayScore: 1 },
  { period: 1, homeScore: 3, awayScore: 2 },
];

describe('MatchMomentum', () => {
  it('renders heading', () => {
    render(<MatchMomentum scoreFlow={scoreFlow} homeTeam="Thunder" awayTeam="Lightning" />);
    expect(screen.getByText('Match Momentum')).toBeInTheDocument();
  });

  it('renders SVG chart', () => {
    const { container } = render(
      <MatchMomentum scoreFlow={scoreFlow} homeTeam="Thunder" awayTeam="Lightning" />
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders team legend', () => {
    render(<MatchMomentum scoreFlow={scoreFlow} homeTeam="Thunder" awayTeam="Lightning" />);
    expect(screen.getByText('Thunder')).toBeInTheDocument();
    expect(screen.getByText('Lightning')).toBeInTheDocument();
  });
});
