import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { AppShell } from '../AppShell';
import type { EditionContextValue } from '@/lib/edition-context';

const editions: EditionContextValue[] = [{
  id: 'glasgow',
  competitionSlug: 'commonwealth-games',
  competitionName: 'Commonwealth Games',
  editionSlug: 'glasgow-2026',
  editionLabel: 'Glasgow 2026',
  sourceTimezone: 'Europe/London',
}];

const { pathnameMock } = vi.hoisted(() => ({
  pathnameMock: vi.fn(() => '/'),
}));

vi.mock('next/navigation', () => ({
  usePathname: pathnameMock,
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
  useLinkStatus: () => ({ pending: false }),
}));

describe('AppShell', () => {
  afterEach(() => {
    pathnameMock.mockReturnValue('/');
    vi.unstubAllGlobals();
  });

  it('renders children content', () => {
    render(<AppShell><div data-testid="child">Content</div></AppShell>);
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('uses landing chrome without the desktop sidebar on the root route', () => {
    render(<AppShell><div>Content</div></AppShell>);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('preserves the standard sidebar shell away from the root route', () => {
    pathnameMock.mockReturnValue('/live');
    render(<AppShell><div>Content</div></AppShell>);

    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
  });

  it('renders navigation elements', () => {
    render(<AppShell><div>Content</div></AppShell>);
    const navElements = screen.getAllByRole('navigation');
    expect(navElements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders one compact competition selector in the landing header', () => {
    render(<AppShell editions={editions}><div>Content</div></AppShell>);

    expect(screen.getAllByLabelText('Competition edition')).toHaveLength(1);
  });

  it('renders competition selection on desktop and mobile standard surfaces', () => {
    pathnameMock.mockReturnValue('/live');
    render(<AppShell editions={editions}><div>Content</div></AppShell>);

    expect(screen.getAllByLabelText('Competition edition')).toHaveLength(2);
  });

  it('renders CentrePass branding', () => {
    render(<AppShell><div>Content</div></AppShell>);
    expect(screen.getByText('CentrePass')).toBeInTheDocument();
  });

  it('shares one live-status polling stream across desktop and mobile navigation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hasLive: false, nextMatchAt: null }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppShell><div>Content</div></AppShell>);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/live-status', { cache: 'no-store' });
  });
});
