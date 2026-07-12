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

const completedMatch = {
  ...liveMatch,
  id: '3',
  status: 'COMPLETED' as const,
  homeScore: 64,
  awayScore: 58,
  currentQuarter: null,
  currentTime: null,
  scheduledAt: '2026-04-05T05:00:00Z',
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

  it('renders with flex column layout for consistent card heights', () => {
    const { container } = render(<ScoreCard match={liveMatch} />);
    const link = container.querySelector('a');
    expect(link?.className).toContain('flex');
    expect(link?.className).toContain('flex-col');
    expect(link?.className).toContain('h-full');
  });

  it('renders score section with flex-grow for vertical centering', () => {
    const { container } = render(<ScoreCard match={liveMatch} />);
    // The score display wrapper should have flex-1
    const scoreSection = container.querySelector('[data-testid="score-display"]');
    expect(scoreSection?.className).toContain('flex-1');
  });

  it('keeps long team names inside the responsive score grid', () => {
    render(<ScoreCard match={{
      ...completedMatch,
      homeTeam: { ...completedMatch.homeTeam, name: 'Manchester Thunder Netball Club' },
      awayTeam: { ...completedMatch.awayTeam, name: 'London Mavericks Netball Club' },
    }} />);

    expect(screen.getByText('Manchester Thunder Netball Club')).toHaveClass('break-words');
    expect(screen.getByText('London Mavericks Netball Club')).toHaveClass('break-words');
    expect(screen.getByTestId('score-display').firstElementChild).toHaveClass(
      'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]',
    );
  });

  it('shows Final badge for completed matches by default', () => {
    render(<ScoreCard match={completedMatch} />);
    expect(screen.getByText('Final')).toBeInTheDocument();
  });

  it('hides Final badge when showFinalBadge is false', () => {
    render(<ScoreCard match={completedMatch} showFinalBadge={false} />);
    expect(screen.queryByText('Final')).not.toBeInTheDocument();
  });

  it('shows date/time when showFinalBadge is false for completed matches', () => {
    render(<ScoreCard match={completedMatch} showFinalBadge={false} />);
    // formatMatchDateTime produces "Sun, 5 Apr, 3:00 pm" for 2026-04-05T05:00:00Z
    // Use full string to avoid matching the footer which also contains "Sun, 5 Apr"
    expect(screen.getByText(/Sun, 5 Apr, 3:00\s*pm/)).toBeInTheDocument();
  });

  it('shows super shot breakdown when present', () => {
    render(<ScoreCard match={{
      ...completedMatch,
      homeBreakdown: { goals: 39, superShots: 6 },
      awayBreakdown: { goals: 63, superShots: 3 },
    }} />);
    expect(screen.getByText('(39.6)')).toBeInTheDocument();
    expect(screen.getByText('(63.3)')).toBeInTheDocument();
  });

  it('does not show breakdown when no super shots', () => {
    render(<ScoreCard match={{
      ...completedMatch,
      homeBreakdown: { goals: 64, superShots: 0 },
      awayBreakdown: { goals: 58, superShots: 0 },
    }} />);
    expect(screen.queryByText(/\(\d+\.\d+\)/)).not.toBeInTheDocument();
  });

  it('does not show breakdown when not provided', () => {
    render(<ScoreCard match={completedMatch} />);
    expect(screen.queryByText(/\(\d+\.\d+\)/)).not.toBeInTheDocument();
  });
});
