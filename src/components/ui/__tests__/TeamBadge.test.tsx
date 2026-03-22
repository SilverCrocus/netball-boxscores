import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TeamBadge } from '../TeamBadge';

describe('TeamBadge', () => {
  it('renders team name', () => {
    render(<TeamBadge name="Melbourne Vixens" abbreviation="VIX" />);
    expect(screen.getByText('Melbourne Vixens')).toBeInTheDocument();
  });

  it('renders logo when provided', () => {
    render(<TeamBadge name="Vixens" abbreviation="VIX" logoUrl="/vixens.png" />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toContain('vixens.png');
  });

  it('renders abbreviation fallback when no logo', () => {
    render(<TeamBadge name="Vixens" abbreviation="VIX" />);
    expect(screen.getByText('V')).toBeInTheDocument();
  });
});
