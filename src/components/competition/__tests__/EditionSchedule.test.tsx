import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditionSchedule } from '@/components/competition/EditionSchedule';
import { buildEditionSchedule, type EditionScheduleMatchRecord } from '@/lib/edition-schedule';

const unresolvedMatch = {
  id: 'semi-final-one',
  scheduledAt: new Date('2026-08-01T08:00:00.000Z'),
  status: 'SCHEDULED',
  resultQuality: 'UNKNOWN',
  homeScore: 0,
  awayScore: 0,
  venue: 'The Hydro',
  neutralVenue: true,
  round: null,
  roundLabel: 'Semi-final 1',
  finalCode: null,
  homeTeam: null,
  awayTeam: null,
  stage: { id: 'semis', slug: 'semi-finals', name: 'Semi-finals', type: 'SEMI_FINALS', sequence: 1 },
  stageGroup: null,
  dataCoverage: [],
  slots: [
    { side: 'A', sourceLabel: 'Semi-finalist from Pool A', resolvedEntry: null },
    { side: 'B', sourceLabel: 'Semi-finalist from Pool B', resolvedEntry: null },
  ],
} as EditionScheduleMatchRecord;

const schedule = buildEditionSchedule({
  id: 'glasgow-2026',
  competitionName: 'Commonwealth Games Netball',
  editionLabel: 'Glasgow 2026',
  competitionKind: 'TOURNAMENT',
  sourceTimezone: 'Europe/London',
  teamCount: 12,
  editionCoverage: [{ capability: 'FINAL_SCORE', state: 'UNAVAILABLE' }],
}, [unresolvedMatch]);

describe('EditionSchedule', () => {
  it('explains the Sydney display timezone and exposes schedule structure to assistive technology', () => {
    render(<EditionSchedule schedule={schedule} />);

    expect(screen.getByRole('heading', { name: 'Full schedule' })).toBeInTheDocument();
    expect(screen.getByText(/Sydney time \(AEST, Australia\/Sydney\)/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Semi-finals' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Saturday, 1 August 2026' })).toBeInTheDocument();
  });

  it('uses source-derived participant labels without inventing a scheduled score or dead match link', () => {
    render(<EditionSchedule schedule={schedule} />);

    const card = screen.getByTestId('edition-fixture');
    expect(card.tagName).toBe('ARTICLE');
    expect(within(card).getByText('Semi-finalist from Pool A')).toBeInTheDocument();
    expect(within(card).getByText('Semi-finalist from Pool B')).toBeInTheDocument();
    expect(within(card).getByText('18:00 AEST')).toBeInTheDocument();
    expect(card).toHaveTextContent('Awaiting qualification');
    expect(card.textContent).not.toMatch(/0\s*[–-]\s*0/);
    expect(card.textContent).not.toContain('TBC');
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
  });
});
