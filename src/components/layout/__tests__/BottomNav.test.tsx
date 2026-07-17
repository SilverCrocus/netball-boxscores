import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BottomNav } from '../BottomNav';
import type { EditionContextValue } from '@/lib/edition-context';

const glasgow: EditionContextValue = {
  id: 'glasgow',
  competitionSlug: 'commonwealth-games',
  competitionName: 'Commonwealth Games',
  editionSlug: 'glasgow-2026',
  editionLabel: 'Glasgow 2026',
  sourceTimezone: 'Europe/London',
};

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
  signOut: vi.fn(),
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
    expect(screen.getByText('More')).toBeInTheDocument();
  });

  it('renders correct hrefs', () => {
    render(<BottomNav analyticsEnabled askCentrePassEnabled />);
    expect(screen.getByText('Fixtures').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText('Standings').closest('a')).toHaveAttribute('href', '/standings');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('link', { name: /Browse teams/ })).toHaveAttribute('href', '/teams');
    expect(screen.getByRole('link', { name: /^Ask CentrePass$/ })).toHaveAttribute('href', '/explore');
  });

  it('renders material icons', () => {
    render(<BottomNav />);
    expect(screen.getByText('calendar_today')).toHaveClass('material-symbols-outlined');
    expect(screen.getByText('sensors')).toHaveClass('material-symbols-outlined');
    expect(screen.getByText('leaderboard')).toHaveClass('material-symbols-outlined');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByText('groups')).toHaveClass('material-symbols-outlined');
  });

  it('closes the More dialog with Escape and restores focus', () => {
    render(<BottomNav />);
    const moreButton = screen.getByRole('button', { name: 'More' });
    fireEvent.click(moreButton);
    expect(screen.getByRole('dialog', { name: 'More' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(moreButton).toHaveFocus();
  });

  it('scopes fixtures, standings, and teams to the selected edition', () => {
    render(<BottomNav editions={[glasgow]} />);

    expect(screen.getByText('Fixtures').closest('a')).toHaveAttribute(
      'href',
      '/competitions/commonwealth-games/glasgow-2026'
    );
    expect(screen.getByText('Standings').closest('a')).toHaveAttribute(
      'href',
      '/competitions/commonwealth-games/glasgow-2026/standings'
    );

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('link', { name: /Browse teams/ })).toHaveAttribute(
      'href',
      '/competitions/commonwealth-games/glasgow-2026/teams'
    );
  });

  it('hides analytics tabs and the Ask menu entry when disabled', () => {
    render(<BottomNav analyticsEnabled={false} askCentrePassEnabled={false} />);

    expect(screen.queryByText('Rankings')).not.toBeInTheDocument();
    expect(screen.queryByText('Records')).not.toBeInTheDocument();
    expect(screen.queryByText('Compare')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByRole('link', { name: /^Ask CentrePass$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Browse teams/ })).toBeInTheDocument();
  });
});
