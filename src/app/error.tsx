'use client';

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ reset }: AppErrorProps) {
  return (
    <section
      role="alert"
      className="mx-auto max-w-3xl rounded-3xl border border-error/25 bg-surface-container-lowest px-6 py-14 text-center shadow-xl sm:px-10"
    >
      <span aria-hidden="true" className="material-symbols-outlined text-5xl text-error">
        cloud_off
      </span>
      <p className="mt-4 font-label text-xs font-black uppercase tracking-[0.18em] text-error">
        Page unavailable
      </p>
      <h1 className="mt-2 font-headline text-3xl font-black text-primary sm:text-4xl">
        CentrePass couldn’t load this page
      </h1>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-on-surface-variant sm:text-base">
        The data service may be temporarily unavailable. This is not an empty result—please try again shortly.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-7 min-h-11 rounded-xl bg-secondary px-6 font-headline text-sm font-bold text-white focus:outline-none focus:ring-4 focus:ring-secondary/30"
      >
        Try again
      </button>
    </section>
  );
}
