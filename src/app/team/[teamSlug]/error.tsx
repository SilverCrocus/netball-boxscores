'use client';

import Link from 'next/link';
import type { ErrorInfo } from 'next/error';

export default function TeamPageError({ unstable_retry }: ErrorInfo) {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-2xl items-center px-4 py-16">
      <section
        aria-labelledby="team-page-error-title"
        className="w-full rounded-2xl bg-surface-container-low p-6 text-center shadow-sm sm:p-10"
        role="alert"
      >
        <h1
          className="font-headline text-3xl font-black text-primary"
          id="team-page-error-title"
        >
          Team details are temporarily unavailable
        </h1>
        <p className="mt-3 font-body text-on-surface-variant">
          CentrePass could not load this team&apos;s current results and fixtures. Please try again.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            className="rounded-xl bg-primary px-5 py-3 font-headline text-sm font-bold text-on-primary focus:outline-none focus:ring-4 focus:ring-primary/30"
            onClick={unstable_retry}
            type="button"
          >
            Try again
          </button>
          <Link
            className="rounded-xl border border-outline-variant px-5 py-3 font-headline text-sm font-bold text-primary focus:outline-none focus:ring-4 focus:ring-primary/20"
            href="/teams"
          >
            Back to teams
          </Link>
        </div>
      </section>
    </main>
  );
}
