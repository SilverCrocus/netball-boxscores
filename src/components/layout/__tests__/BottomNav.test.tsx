import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BottomNav } from '../BottomNav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe('BottomNav', () => {
  it('renders as nav element', () => {
    render(<BottomNav />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders navigation links', () => {
    render(<BottomNav />);
    expect(screen.getByText('Fixtures')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Standings')).toBeInTheDocument();
    expect(screen.getByText('Teams')).toBeInTheDocument();
  });

  it('renders correct hrefs', () => {
    render(<BottomNav />);
    expect(screen.getByText('Fixtures').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText('Standings').closest('a')).toHaveAttribute('href', '/standings');
    expect(screen.getByText('Teams').closest('a')).toHaveAttribute('href', '/teams');
  });

  it('renders material icons', () => {
    render(<BottomNav />);
    expect(screen.getByText('calendar_today')).toHaveClass('material-symbols-outlined');
    expect(screen.getByText('sensors')).toHaveClass('material-symbols-outlined');
    expect(screen.getByText('leaderboard')).toHaveClass('material-symbols-outlined');
    expect(screen.getByText('groups')).toHaveClass('material-symbols-outlined');
  });
});
