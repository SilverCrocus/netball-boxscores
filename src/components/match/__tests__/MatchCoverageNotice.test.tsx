import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MatchCoverageNotice } from '@/components/match/MatchCoverageNotice';
import { resolveEditionFeatures } from '@/lib/edition-capabilities';

describe('MatchCoverageNotice', () => {
  it('describes a scheduled fixture without presenting missing data as zero', () => {
    render(<MatchCoverageNotice
      status="SCHEDULED"
      features={resolveEditionFeatures([])}
    />);

    expect(screen.getByRole('heading', { name: 'Scheduled fixture' })).toBeInTheDocument();
    expect(screen.getByText(/Scores and match statistics will appear/)).toBeInTheDocument();
    expect(screen.queryByText(/0-0/)).not.toBeInTheDocument();
  });
});
