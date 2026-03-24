import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TeamBadge } from '../TeamBadge';

describe('TeamBadge', () => {
  it('renders abbreviation fallback when no logo', () => {
    render(<TeamBadge team={{ name: 'Melbourne Vixens', abbreviation: 'VIX' }} size={40} />);
    expect(screen.getByText('V')).toBeInTheDocument();
  });

  it('renders logo when provided', () => {
    render(<TeamBadge team={{ name: 'Vixens', abbreviation: 'VIX', logoUrl: '/vixens.png' }} size={40} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toContain('vixens.png');
  });

  it('renders abbreviation fallback when no logo', () => {
    render(<TeamBadge team={{ name: 'Vixens', abbreviation: 'VIX' }} size={40} />);
    expect(screen.getByText('V')).toBeInTheDocument();
  });
});
