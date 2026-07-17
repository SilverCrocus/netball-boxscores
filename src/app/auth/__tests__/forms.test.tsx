import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SignInPage from '../signin/page';
import SignUpPage from '../signup/page';

const { signInMock, navigateAfterSignInMock, searchParams } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  navigateAfterSignInMock: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('next-auth/react', () => ({ signIn: signInMock }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));
vi.mock('@/lib/sign-in-navigation', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/sign-in-navigation')>(),
  navigateAfterSignIn: navigateAfterSignInMock,
}));

describe('authentication forms', () => {
  beforeEach(() => {
    signInMock.mockReset();
    navigateAfterSignInMock.mockReset();
    searchParams.delete('callbackUrl');
  });

  it('connects sign-in labels, autocomplete, and password visibility', () => {
    render(<SignInPage />);

    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(password).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
  });

  it('connects sign-up labels and password guidance', () => {
    render(<SignUpPage />);

    expect(screen.getByLabelText('Name')).toHaveAttribute('autocomplete', 'name');
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAccessibleDescription('Minimum 8 characters');
    expect(password).toHaveAttribute('autocomplete', 'new-password');
  });

  it('completes a private credentials callback without client-side router history', async () => {
    searchParams.set('callbackUrl', '/admin/preview/glasgow-2026');
    signInMock.mockResolvedValue({
      url: 'https://centrepass.test/admin/preview/glasgow-2026',
    });
    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'operator@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(navigateAfterSignInMock).toHaveBeenCalledWith(
      'https://centrepass.test/admin/preview/glasgow-2026',
    ));
    expect(signInMock).toHaveBeenCalledWith('credentials', {
      email: 'operator@example.test',
      password: 'password123',
      redirect: false,
      callbackUrl: '/admin/preview/glasgow-2026',
    });
  });

  it('rejects a cross-origin callback before either credentials or Google sign-in', async () => {
    searchParams.set('callbackUrl', 'https://attacker.example/steal');
    signInMock.mockResolvedValue({ error: 'CredentialsSignin' });
    render(<SignInPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(signInMock).toHaveBeenCalledWith('google', { callbackUrl: '/' });
  });
});
