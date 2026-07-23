import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AuthButton } from '../AuthButton';

const { signOutMock, useSessionMock } = vi.hoisted(() => ({
  signOutMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: useSessionMock,
  signOut: signOutMock,
}));

vi.mock('next/link', () => ({
  default: ({ children, href, prefetch, ...props }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
    [key: string]: unknown;
  }) => <a href={href} data-prefetch={prefetch === false ? 'false' : 'default'} {...props}>{children}</a>,
}));

describe('AuthButton', () => {
  it('links signed-out visitors to sign in', () => {
    useSessionMock.mockReturnValue({ data: null, status: 'unauthenticated' });
    render(<AuthButton />);

    expect(screen.getByRole('link', { name: 'Sign In' })).toHaveAttribute('href', '/auth/signin');
    expect(screen.getByRole('link', { name: 'Sign In' })).toHaveAttribute('data-prefetch', 'false');
  });

  it('exposes settings and sign out for signed-in users', () => {
    useSessionMock.mockReturnValue({
      data: { user: { name: 'Maya', email: 'maya@example.com' } },
      status: 'authenticated',
    });
    render(<AuthButton />);

    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('data-prefetch', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/' });
  });
});
