'use client';

import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';

export function AuthButton() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return (
      <div className="w-8 h-8 rounded-full bg-surface-container-high animate-pulse" />
    );
  }

  if (session?.user) {
    return (
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-secondary text-on-secondary flex items-center justify-center font-headline font-bold text-xs">
          {session.user.name?.charAt(0).toUpperCase() || 'U'}
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="font-label text-xs text-on-surface-variant hover:text-on-surface transition-colors"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <Link
      href="/auth/signin"
      className="font-label text-xs font-bold uppercase tracking-wider text-secondary hover:text-secondary/80 transition-colors"
    >
      Sign In
    </Link>
  );
}
