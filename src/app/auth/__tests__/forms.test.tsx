import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SignInPage from '../signin/page';
import SignUpPage from '../signup/page';

const {
  fetchMock,
  getProvidersMock,
  signInMock,
  navigateAfterSignInMock,
  searchParams,
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  getProvidersMock: vi.fn(),
  signInMock: vi.fn(),
  navigateAfterSignInMock: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('next-auth/react', () => ({
  getProviders: getProvidersMock,
  signIn: signInMock,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));
vi.mock('@/lib/sign-in-navigation', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/sign-in-navigation')>(),
  navigateAfterSignIn: navigateAfterSignInMock,
}));

describe('authentication forms', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    getProvidersMock.mockReset().mockReturnValue(new Promise(() => {}));
    signInMock.mockReset();
    navigateAfterSignInMock.mockReset();
    searchParams.delete('callbackUrl');
    searchParams.delete('error');
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
    getProvidersMock.mockResolvedValue({ google: { id: 'google' } });
    render(<SignInPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    expect(signInMock).toHaveBeenCalledWith('google', { callbackUrl: '/' });
  });

  it('only offers Google sign-in when NextAuth reports the provider', async () => {
    getProvidersMock.mockResolvedValue({
      credentials: { id: 'credentials' },
      google: { id: 'google' },
    });
    render(<SignInPage />);

    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByText('or')).toBeInTheDocument();
  });

  it.each([
    ['credentials only', { credentials: { id: 'credentials' } }],
    ['no providers', null],
  ])('hides Google sign-in when provider discovery returns %s', async (_label, providers) => {
    getProvidersMock.mockResolvedValue(providers);
    render(<SignInPage />);

    await waitFor(() => expect(getProvidersMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
    expect(screen.queryByText('or')).not.toBeInTheDocument();
  });

  it('keeps Google sign-in hidden when provider discovery fails', async () => {
    getProvidersMock.mockRejectedValue(new Error('provider endpoint unavailable'));
    render(<SignInPage />);

    await waitFor(() => expect(getProvidersMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
    expect(screen.queryByText('or')).not.toBeInTheDocument();
  });

  it.each([
    ['google', 'Sign in could not be completed. Please try again or use your email and password.'],
    ['OAuthCallback', 'Sign in could not be completed. Please try again or use your email and password.'],
    ['OAuthAccountNotLinked', 'An account already exists with this email. Sign in with the same method you used when creating it.'],
    ['AccessDenied', 'Google sign-in was cancelled or access was denied. Please try again or use your email and password.'],
    ['not-a-real-error', 'Sign in could not be completed. Please try again or use your email and password.'],
  ])('shows a safe message for the %s redirect error', (code, message) => {
    searchParams.set('error', code);
    render(<SignInPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('alert')).not.toHaveTextContent('not-a-real-error');
  });

  it('signs in a newly created credentials account without a default redirect', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    signInMock.mockResolvedValue({ url: 'https://centrepass.test/' });
    render(<SignUpPage />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New User' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => expect(navigateAfterSignInMock).toHaveBeenCalledWith(
      'https://centrepass.test/',
    ));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New User',
        email: 'new@example.test',
        password: 'password123',
      }),
    });
    expect(signInMock).toHaveBeenCalledWith('credentials', {
      email: 'new@example.test',
      password: 'password123',
      redirect: false,
      callbackUrl: '/',
    });
  });

  it('explains that signup succeeded when automatic credentials sign-in fails', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    signInMock.mockResolvedValue({ error: 'CredentialsSignin' });
    render(<SignUpPage />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New User' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your account was created, but we could not sign you in automatically.',
    );
    expect(navigateAfterSignInMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeEnabled();
  });
});
