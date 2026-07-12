import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { AppShell } from '../AppShell';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe('AppShell', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders children content', () => {
    render(<AppShell><div data-testid="child">Content</div></AppShell>);
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders sidebar on desktop', () => {
    render(<AppShell><div>Content</div></AppShell>);
    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });

  it('renders navigation elements', () => {
    render(<AppShell><div>Content</div></AppShell>);
    const navElements = screen.getAllByRole('navigation');
    expect(navElements.length).toBeGreaterThanOrEqual(1);
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
