import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TeamBadge } from '../TeamBadge';

describe('TeamBadge', () => {
  it('renders abbreviation fallback when no logo', () => {
    render(<TeamBadge team={{ name: 'Melbourne Vixens', abbreviation: 'VIX' }} size={40} />);
    expect(screen.getByRole('img', { name: 'Melbourne Vixens badge' })).toHaveTextContent('VIX');
  });

  it('renders logo when provided', () => {
    render(<TeamBadge team={{ name: 'Vixens', abbreviation: 'VIX', logoUrl: '/vixens.png' }} size={40} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toContain('vixens.png');
  });

  it('renders abbreviation fallback when no logo', () => {
    render(<TeamBadge team={{ name: 'Vixens', abbreviation: 'VIX' }} size={40} />);
    expect(screen.getByRole('img', { name: 'Vixens badge' })).toHaveTextContent('VIX');
  });

  it('falls back to an abbreviation tile when the remote image fails', () => {
    render(<TeamBadge team={{ name: 'Vixens', abbreviation: 'VIX', logoUrl: '/broken.png' }} size={40} />);

    fireEvent.error(screen.getByRole('img', { name: 'Vixens badge' }));

    expect(screen.getByRole('img', { name: 'Vixens badge' })).toHaveTextContent('VIX');
  });
});
