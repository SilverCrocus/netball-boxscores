interface RouteLoadingProps {
  message?: string;
}

export function RouteLoading({
  message = 'Loading CentrePass…',
}: RouteLoadingProps) {
  return (
    <section
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="mx-auto min-h-[32rem] max-w-7xl overflow-hidden rounded-[2rem] bg-surface-container-lowest shadow-sm"
    >
      <div className="kinetic-gradient flex min-h-56 items-center px-6 py-10 text-white sm:px-8 md:px-10">
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="material-symbols-outlined animate-spin text-4xl text-lime-300"
          >
            progress_activity
          </span>
          <div>
            <p className="font-label text-xs font-black uppercase tracking-[0.18em] text-lime-300">
              CentrePass
            </p>
            <p className="mt-2 font-headline text-2xl font-black sm:text-3xl">
              {message}
            </p>
            <p className="mt-2 max-w-xl font-body text-sm text-slate-300">
              Fetching the latest scores, fixtures and competition details.
            </p>
          </div>
        </div>
      </div>

      <div aria-hidden="true" className="grid gap-4 p-6 sm:grid-cols-2 sm:p-8">
        <div className="h-32 animate-pulse rounded-2xl bg-surface-container" />
        <div className="h-32 animate-pulse rounded-2xl bg-surface-container" />
      </div>
    </section>
  );
}
