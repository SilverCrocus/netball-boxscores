interface TournamentPageHeroProps {
  eyebrow: string;
  title: string;
  description: string;
  icon: string;
  facts?: Array<{ label: string; value: string }>;
}
export function TournamentPageHero({
  eyebrow,
  title,
  description,
  icon,
  facts = [],
}: TournamentPageHeroProps) {
  return (
    <header className="kinetic-gradient relative mb-8 overflow-hidden rounded-3xl px-5 py-8 text-white shadow-2xl sm:px-8 md:px-10 md:py-10">
      <div
        aria-hidden="true"
        className="absolute -right-16 -top-20 h-64 w-64 rounded-full border-[42px] border-secondary/15"
      />
      <div
        aria-hidden="true"
        className="absolute bottom-0 right-20 h-px w-48 rotate-[-32deg] bg-secondary/60 shadow-[0_0_24px_rgba(117,255,104,0.65)]"
      />
      <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="max-w-3xl">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-on-secondary shadow-[0_0_24px_rgba(117,255,104,0.28)]">
              <span aria-hidden="true" className="material-symbols-outlined">
                {icon}
              </span>
            </span>
            <p className="font-label text-xs font-bold uppercase tracking-[0.22em] text-secondary-fixed">
              {eyebrow}
            </p>
          </div>
          <h2 className="font-headline text-4xl font-black uppercase leading-[0.95] tracking-[-0.04em] sm:text-5xl md:text-6xl">
            {title}
          </h2>
          <p className="mt-5 max-w-2xl font-body text-sm leading-6 text-primary-fixed-dim sm:text-base">
            {description}
          </p>
        </div>

        {facts.length > 0 ? (
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/15 bg-white/10 sm:min-w-72">
            {facts.map((fact) => (
              <div key={fact.label} className="bg-primary/70 px-4 py-4 backdrop-blur-sm">
                <dt className="font-label text-[10px] font-bold uppercase tracking-[0.16em] text-primary-fixed-dim">
                  {fact.label}
                </dt>
                <dd className="mt-1 font-headline text-2xl font-black text-secondary-fixed">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </header>
  );
}
