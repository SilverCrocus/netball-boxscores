import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ScoreCard } from '../ScoreCard';

const liveMatch = {
  id: '1',
  homeTeam: { name: 'Vixens', abbreviation: 'VIX', logoUrl: null },
  awayTeam: { name: 'Firebirds', abbreviation: 'FIR', logoUrl: null },
  homeScore: 42,
  awayScore: 38,
  status: 'LIVE' as const,
  currentQuarter: 3,
  currentTime: '04:12',
  round: 12,
  venue: 'Arena',
};

const scheduledMatch = {
  ...liveMatch,
  id: '2',
  homeScore: 0,
  awayScore: 0,
  status: 'SCHEDULED' as const,
  currentQuarter: null,
  currentTime: null,
  scheduledAt: '2026-03-25T09:30:00Z',
};

describe('ScoreCard', () => {
  it('renders both team names', () => {
    render(<ScoreCard match={liveMatch} />);
    expect(screen.getByText('Vixens')).toBeInTheDocument();
    expect(screen.getByText('Firebirds')).toBeInTheDocument();
  });

  it('renders scores', () => {
    render(<ScoreCard match={liveMatch} />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('38')).toBeInTheDocument();
  });

  it('shows LIVE indicator for live matches', () => {
    render(<ScoreCard match={liveMatch} />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('shows quarter info for live matches', () => {
    render(<ScoreCard match={liveMatch} />);
    expect(screen.getByText(/Q3/)).toBeInTheDocument();
  });

  it('does not show LIVE indicator for scheduled matches', () => {
    render(<ScoreCard match={scheduledMatch} />);
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
  });
});
