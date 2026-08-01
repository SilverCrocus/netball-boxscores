'use client';

import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';

interface AuthButtonProps {
  dark?: boolean;
  onNavigate?: () => void;
  compact?: boolean;
}

export function AuthButton({ dark = false, onNavigate, compact = false }: AuthButtonProps) {
  const { data: session, status } = useSession();
  const mutedText = dark ? 'text-slate-400' : 'text-on-surface-variant';
  const strongText = dark ? 'text-white' : 'text-on-surface';

  if (status === 'loading') {
    return (
      <div role="status" className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className={`${compact ? 'h-10 w-20 rounded-lg' : 'h-9 w-9 rounded-full'} animate-pulse bg-surface-container-high`}
        />
        <span className="sr-only">Loading account</span>
      </div>
    );
  }

  if (session?.user) {
    if (compact) {
      return (
        <Link
          href="/settings"
          prefetch={false}
          onClick={onNavigate}
          className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 font-label text-xs font-bold ${
            dark
              ? 'border-slate-600 text-white hover:border-secondary-fixed hover:text-secondary-fixed'
              : 'border-outline-variant text-on-surface hover:border-secondary'
          }`}
        >
          <span
            aria-hidden="true"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary-fixed text-[10px] text-on-secondary-fixed"
          >
            {session.user.name?.charAt(0).toUpperCase() || session.user.email?.charAt(0).toUpperCase() || 'U'}
          </span>
          <span className="max-w-24 truncate">{session.user.name || 'Account'}</span>
        </Link>
      );
    }

    return (
      <div className="space-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <div aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-on-secondary">
            {session.user.name?.charAt(0).toUpperCase() || session.user.email?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div className="min-w-0">
            <p className={`truncate font-headline text-sm font-bold ${strongText}`}>{session.user.name || 'CentrePass account'}</p>
            <p className={`truncate font-label text-[10px] ${mutedText}`}>{session.user.email}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/settings"
            prefetch={false}
            onClick={onNavigate}
            className={`min-h-10 rounded-lg border border-outline-variant/30 px-3 py-2 text-center font-label text-xs font-bold ${strongText}`}
          >
            Settings
          </Link>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/' })}
            className={`min-h-10 rounded-lg border border-outline-variant/30 px-3 py-2 font-label text-xs font-bold ${mutedText}`}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <Link
      href="/auth/signin"
      prefetch={false}
      onClick={onNavigate}
      className={compact
        ? `inline-flex min-h-10 items-center justify-center rounded-lg border px-5 font-label text-xs font-bold uppercase tracking-wider transition-colors ${
            dark
              ? 'border-secondary-fixed/70 text-secondary-fixed hover:bg-secondary-fixed hover:text-on-secondary-fixed'
              : 'border-secondary text-secondary hover:bg-secondary hover:text-white'
          }`
        : 'inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-secondary-fixed px-4 font-label text-xs font-bold uppercase tracking-wider text-on-secondary-fixed transition-colors hover:bg-secondary-fixed-dim'}
    >
      Sign In
    </Link>
  );
}
