'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { navigateAfterSignIn } from '@/lib/sign-in-navigation';

const AUTO_SIGN_IN_ERROR = 'Your account was created, but we could not sign you in automatically. Please use the sign-in link below.';

export default function SignUpPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    let accountCreated = false;

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to create account');
        return;
      }

      accountCreated = true;
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl: '/',
      });

      if (result?.error || !result?.url) {
        setError(AUTO_SIGN_IN_ERROR);
        return;
      }

      navigateAfterSignIn(result.url);
    } catch {
      setError(accountCreated
        ? AUTO_SIGN_IN_ERROR
        : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-headline text-3xl font-black tracking-tighter uppercase italic text-primary-container">
            CentrePass
          </h1>
          <p className="font-body text-on-surface-variant mt-2">
            Create an account to personalize your experience
          </p>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-8 shadow-sm border border-outline-variant/15">
          {error ? (
            <div role="alert" className="bg-error-container text-on-error-container px-4 py-3 rounded-lg mb-6 font-label text-sm">
              {error}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="signup-name" className="block font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                Name
              </label>
              <input
                type="text"
                id="signup-name"
                name="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-outline-variant bg-surface-container-low font-body text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary"
                required
              />
            </div>

            <div>
              <label htmlFor="signup-email" className="block font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                Email
              </label>
              <input
                type="email"
                id="signup-email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-outline-variant bg-surface-container-low font-body text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary"
                required
              />
            </div>

            <div>
              <label htmlFor="signup-password" className="block font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="signup-password"
                  name="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-low px-4 py-3 pr-16 font-body text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary"
                  aria-describedby="signup-password-help"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 px-4 font-label text-xs font-bold text-secondary"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <p id="signup-password-help" className="font-label text-[10px] text-on-surface-variant mt-1">
                Minimum 8 characters
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-container text-white py-3 rounded-lg font-headline font-bold uppercase tracking-wider hover:bg-primary-container/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="text-center mt-6 font-body text-sm text-on-surface-variant">
            Already have an account?{' '}
            <Link
              href="/auth/signin"
              className="text-secondary font-bold hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
