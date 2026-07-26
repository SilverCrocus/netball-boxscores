interface OfficialLiveCentreProps {
  src: string;
  isLive: boolean;
}

export function OfficialLiveCentre({
  src,
  isLive,
}: OfficialLiveCentreProps) {
  return (
    <section
      aria-labelledby="official-live-centre-title"
      className="mx-auto max-w-7xl px-4 pb-8 md:px-8"
    >
      <div className="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
        <header className="flex flex-col gap-4 bg-gradient-to-r from-violet-950 via-violet-800 to-fuchsia-700 px-5 py-5 text-white sm:flex-row sm:items-center sm:justify-between md:px-7">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2
                id="official-live-centre-title"
                className="text-xl font-bold tracking-tight md:text-2xl"
              >
                Official Glasgow 2026 live centre
              </h2>
              <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset ring-white/25">
                Official data
              </span>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-violet-50">
              Player box scores, match statistics, the in-game clock and
              play-by-play are displayed directly from the official results
              system. The available detail can vary by fixture.
            </p>
          </div>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-violet-900"
          >
            Open full screen
            <span aria-hidden="true" className="ml-1.5">↗</span>
          </a>
        </header>

        <iframe
          src={src}
          title="Official Glasgow 2026 player statistics and play-by-play"
          sandbox="allow-scripts allow-same-origin allow-popups"
          referrerPolicy="no-referrer"
          loading={isLive ? 'eager' : 'lazy'}
          allowFullScreen
          className="h-[760px] w-full border-0 bg-white md:h-[920px] xl:h-[1040px]"
        />

        <p className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs leading-5 text-slate-600 md:px-7">
          Source: Glasgow 2026 official detailed results. If an event feed was
          not recorded for a fixture, its play-by-play tab will say so rather
          than showing estimated events.
        </p>
      </div>
    </section>
  );
}
