interface TournamentEmptyStateProps {
  title: string;
  description: string;
  icon: string;
}

export function TournamentEmptyState({ title, description, icon }: TournamentEmptyStateProps) {
  return (
    <section className="rounded-2xl border border-outline-variant bg-surface-container-lowest px-6 py-12 text-center shadow-sm">
      <span
        aria-hidden="true"
        className="material-symbols-outlined rounded-2xl bg-surface-container p-4 text-4xl text-on-surface-variant"
      >
        {icon}
      </span>
      <h3 className="mt-5 font-headline text-2xl font-black uppercase text-primary">{title}</h3>
      <p className="mx-auto mt-2 max-w-lg font-body text-sm leading-6 text-on-surface-variant">
        {description}
      </p>
    </section>
  );
}
