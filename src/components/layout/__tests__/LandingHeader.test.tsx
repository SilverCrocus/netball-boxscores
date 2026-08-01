import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LandingHeader } from '../LandingHeader';
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
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
    [key: string]: unknown;
  }) => (
    <a
      href={href}
      data-prefetch={prefetch === true ? 'true' : prefetch === false ? 'false' : 'default'}
      {...props}
    >
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));

function setConnection(connection: unknown) {
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value: connection,
  });
}

describe('LandingHeader', () => {
  beforeEach(() => {
    setConnection({ saveData: false, effectiveType: '4g' });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'connection');
  });

  it('uses the shared navigation prefetch policy', () => {
    render(
      <LandingHeader
        editions={[glasgow]}
        analyticsEnabled
        askCentrePassEnabled
      />,
    );

    expect(screen.getByRole('link', { name: 'Matches' })).toHaveAttribute(
      'data-prefetch',
      'default',
    );
    expect(screen.getByRole('link', { name: 'Standings' })).toHaveAttribute(
      'data-prefetch',
      'default',
    );
    expect(screen.getByRole('link', { name: 'Teams' })).toHaveAttribute(
      'data-prefetch',
      'false',
    );
    expect(screen.getByRole('link', { name: 'Stats' })).toHaveAttribute(
      'data-prefetch',
      'false',
    );
    expect(screen.getByRole('link', { name: 'Compare' })).toHaveAttribute(
      'data-prefetch',
      'false',
    );
    expect(screen.getByRole('link', { name: 'Ask CentrePass' })).toHaveAttribute(
      'data-prefetch',
      'false',
    );

    fireEvent.focus(screen.getByRole('link', { name: 'Stats' }));

    expect(screen.getByRole('link', { name: 'Stats' })).toHaveAttribute(
      'data-prefetch',
      'true',
    );
  });
});
