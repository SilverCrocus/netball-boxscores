import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Sidebar } from '../Sidebar';
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

describe('Sidebar', () => {
  it('renders as aside element', () => {
    render(<Sidebar />);
    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });

  it('renders CentrePass branding', () => {
    render(<Sidebar />);
    expect(screen.getByText('CentrePass')).toBeInTheDocument();
  });

  it('renders navigation links', () => {
    render(<Sidebar />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Standings')).toBeInTheDocument();
    expect(screen.getByText('Ask CentrePass')).toBeInTheDocument();
    expect(screen.getByText('Teams')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign In' })).toHaveAttribute('href', '/auth/signin');
  });

  it('renders correct hrefs', () => {
    render(<Sidebar />);
    expect(screen.getByText('Home').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText('Standings').closest('a')).toHaveAttribute('href', '/standings');
    expect(screen.getByText('Ask CentrePass').closest('a')).toHaveAttribute('href', '/explore');
    expect(screen.getByText('Teams').closest('a')).toHaveAttribute('href', '/teams');
  });

  it('renders material icons', () => {
    render(<Sidebar />);
    expect(screen.getByText('calendar_today')).toHaveClass('material-symbols-outlined');
    expect(screen.getByText('sensors')).toHaveClass('material-symbols-outlined');
    expect(screen.getByText('leaderboard')).toHaveClass('material-symbols-outlined');
    expect(screen.getByText('groups')).toHaveClass('material-symbols-outlined');
  });

  it('scopes supported links to the selected edition', () => {
    render(<Sidebar editions={[glasgow]} />);

    expect(screen.getByText('Home').closest('a')).toHaveAttribute(
      'href',
      '/competitions/commonwealth-games/glasgow-2026'
    );
    expect(screen.getByText('Standings').closest('a')).toHaveAttribute(
      'href',
      '/competitions/commonwealth-games/glasgow-2026/standings'
    );
    expect(screen.getByText('Teams').closest('a')).toHaveAttribute(
      'href',
      '/competitions/commonwealth-games/glasgow-2026/teams'
    );
  });
});
