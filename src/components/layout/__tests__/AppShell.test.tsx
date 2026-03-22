import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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

  it('renders NETPULSE branding', () => {
    render(<AppShell><div>Content</div></AppShell>);
    expect(screen.getByText('NETPULSE')).toBeInTheDocument();
  });
});
