import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { QuarterScoreBar } from '../QuarterScoreBar';

const quarters = [
  { quarter: 1, homeScore: 16, awayScore: 14 },
  { quarter: 2, homeScore: 12, awayScore: 18 },
  { quarter: 3, homeScore: 20, awayScore: 12 },
  { quarter: 4, homeScore: 16, awayScore: 14 },
];

describe('QuarterScoreBar', () => {
  it('renders all quarter labels', () => {
    render(<QuarterScoreBar quarters={quarters} />);
    expect(screen.getByText('Q1')).toBeInTheDocument();
    expect(screen.getByText('Q4')).toBeInTheDocument();
  });

  it('renders correct number of bars', () => {
    const { container } = render(<QuarterScoreBar quarters={quarters} />);
    const bars = container.querySelectorAll('[data-testid^="quarter-bar-"]');
    expect(bars).toHaveLength(4);
  });
});
