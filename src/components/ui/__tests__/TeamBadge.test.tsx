import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TeamBadge } from '../TeamBadge';

describe('TeamBadge', () => {
  it('keeps club teams on the abbreviation fallback when no logo exists', () => {
    render(<TeamBadge team={{ name: 'Melbourne Vixens', abbreviation: 'VIX' }} size={40} />);
    expect(screen.getByRole('img', { name: 'Melbourne Vixens badge' })).toHaveTextContent('VIX');
  });

  it('renders a flag instead of an abbreviation for an international team', () => {
    render(<TeamBadge team={{ name: 'Australia', abbreviation: 'AUS' }} size={40} />);
    expect(screen.getByRole('img', { name: 'Australia flag' }).getAttribute('src')).toContain(
      '/flags/glasgow-2026/au.svg',
    );
    expect(screen.queryByText('AUS')).not.toBeInTheDocument();
  });

  it('renders logo when provided', () => {
    render(<TeamBadge team={{ name: 'Vixens', abbreviation: 'VIX', logoUrl: '/vixens.png' }} size={40} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toContain('vixens.png');
  });

  it('falls back to an abbreviation tile when the remote image fails', () => {
    render(<TeamBadge team={{ name: 'Vixens', abbreviation: 'VIX', logoUrl: '/broken.png' }} size={40} />);

    fireEvent.error(screen.getByRole('img', { name: 'Vixens badge' }));

    expect(screen.getByRole('img', { name: 'Vixens badge' })).toHaveTextContent('VIX');
  });

  it('falls back to a country flag when an international logo fails', () => {
    render(<TeamBadge team={{ name: 'Jamaica', abbreviation: 'JAM', logoUrl: '/broken.png' }} size={40} />);

    fireEvent.error(screen.getByRole('img', { name: 'Jamaica badge' }));

    expect(screen.getByRole('img', { name: 'Jamaica flag' }).getAttribute('src')).toContain(
      '/flags/glasgow-2026/jm.svg',
    );
  });
});
