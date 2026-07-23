import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
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

let currentPathname = '/';

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
  signOut: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, prefetch, ...props }: { children: React.ReactNode; href: string; prefetch?: boolean; [key: string]: unknown }) => (
    <a href={href} data-prefetch={prefetch === true ? 'true' : prefetch === false ? 'false' : 'default'} {...props}>{children}</a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));

describe('BottomNav', () => {
  beforeEach(() => {
    currentPathname = '/';
    document.body.style.overflow = '';
  });

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

  it('locks background scrolling and traps keyboard focus inside the More dialog', () => {
    render(<BottomNav />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));

    const dialog = screen.getByRole('dialog', { name: 'More' });
    const closeButton = within(dialog).getByRole('button', { name: 'Close more menu' });
    const lastControl = within(dialog).getByRole('link', { name: 'Sign In' });
    expect(document.body).toHaveStyle({ overflow: 'hidden' });
    expect(closeButton).toHaveFocus();

    lastControl.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(lastControl).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.body.style.overflow).toBe('');
  });

  it('blocks background pointer and focus interaction while the More dialog is open', () => {
    const backgroundClick = vi.fn();
    render(
      <div>
        <main onClick={backgroundClick}><a href="/standings">Background standings</a></main>
        <BottomNav />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'More' }));

    const dialog = screen.getByRole('dialog', { name: 'More' });
    const closeButton = within(dialog).getByRole('button', { name: 'Close more menu' });
    const backgroundLink = screen.getByRole('link', { name: 'Background standings', hidden: true });
    const backgroundMain = backgroundLink.closest('main');
    const backgroundNav = screen.getByRole('navigation', { hidden: true });
    expect(backgroundMain).toHaveAttribute('inert');
    expect(backgroundMain).toHaveAttribute('aria-hidden', 'true');
    expect(backgroundNav).toHaveAttribute('inert');
    const modalLayer = screen.getByTestId('mobile-more-modal-layer');
    expect(modalLayer).not.toHaveAttribute('inert');

    fireEvent.click(modalLayer);
    expect(backgroundClick).not.toHaveBeenCalled();

    backgroundLink.focus();
    fireEvent.focusIn(backgroundLink);
    expect(closeButton).toHaveFocus();
  });

  it('closes on a route change and releases scroll and background state', async () => {
    const { rerender } = render(
      <div>
        <main>Page content</main>
        <BottomNav />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(document.body).toHaveStyle({ overflow: 'hidden' });

    currentPathname = '/standings';
    rerender(
      <div>
        <main>Page content</main>
        <BottomNav />
      </div>
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe('');
    expect(screen.getByRole('main')).not.toHaveAttribute('inert');
    expect(screen.getByRole('navigation')).not.toHaveAttribute('inert');
  });

  it('releases scroll and background state when unmounted while open', () => {
    const { unmount } = render(
      <div>
        <main>Page content</main>
        <BottomNav />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const main = screen.getByRole('main', { hidden: true });
    expect(main).toHaveAttribute('inert');

    unmount();

    expect(document.body.style.overflow).toBe('');
    expect(main).not.toHaveAttribute('inert');
    expect(main).not.toHaveAttribute('aria-hidden');
  });

  it('includes dynamically added controls in the focus boundary', () => {
    render(<BottomNav />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const dialog = screen.getByRole('dialog', { name: 'More' });
    const closeButton = within(dialog).getByRole('button', { name: 'Close more menu' });
    const dynamicButton = document.createElement('button');
    dynamicButton.textContent = 'Dynamic action';
    dialog.append(dynamicButton);

    dynamicButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    expect(closeButton).toHaveFocus();
  });

  it('constrains the dialog to a short landscape viewport with a reachable sticky close control', () => {
    render(<BottomNav />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const dialog = screen.getByRole('dialog', { name: 'More' });
    const headingRow = screen.getByRole('heading', { name: 'More' }).parentElement;

    expect(dialog).toHaveStyle({
      bottom: 'calc(5.5rem + env(safe-area-inset-bottom))',
      maxHeight: 'calc(100dvh - 6.5rem - env(safe-area-inset-bottom))',
      overscrollBehavior: 'contain',
    });
    expect(dialog).toHaveClass('overflow-y-auto');
    expect(headingRow).toHaveClass('sticky', 'top-0');
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

  it('uses intent prefetch only for analytics landings and keeps ordinary navigation automatic', () => {
    render(<BottomNav analyticsEnabled askCentrePassEnabled />);

    expect(screen.getByRole('link', { name: 'Rankings' })).toHaveAttribute('data-prefetch', 'false');
    expect(screen.getByRole('link', { name: 'Records' })).toHaveAttribute('data-prefetch', 'false');
    expect(screen.getByRole('link', { name: 'Live' })).toHaveAttribute('data-prefetch', 'default');
    expect(screen.getByRole('link', { name: 'Standings' })).toHaveAttribute('data-prefetch', 'default');
  });
});
