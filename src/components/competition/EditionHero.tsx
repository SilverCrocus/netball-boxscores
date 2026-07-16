import type { EditionSchedule } from '@/lib/edition-schedule';

interface EditionHeroProps {
  schedule: EditionSchedule;
}

export function EditionHero({ schedule }: EditionHeroProps) {
  const { summary } = schedule;
  const lifecycleLabel = summary.liveCount > 0
    ? `${summary.liveCount} live now`
    : summary.fixtureCount > 0 && summary.completedCount === summary.fixtureCount
      ? 'Edition complete'
      : `${summary.scheduledCount} still to play`;

  const facts = [
    { label: 'Fixtures', value: summary.fixtureCount.toLocaleString('en-AU') },
    { label: 'Teams', value: summary.teamCount.toLocaleString('en-AU') },
    { label: 'Stages', value: summary.stageCount.toLocaleString('en-AU') },
    { label: 'Status', value: lifecycleLabel },
  ];

  return (
    <section className="relative mb-12 overflow-hidden rounded-[1.75rem] bg-primary px-5 py-8 text-white shadow-2xl sm:px-8 sm:py-10 lg:px-12 lg:py-12">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full border-[44px] border-secondary/15" />
        <div className="absolute -bottom-32 right-24 h-72 w-72 rounded-full bg-secondary/10 blur-3xl" />
        <div className="absolute inset-y-0 left-[58%] hidden w-px rotate-[18deg] bg-white/10 lg:block" />
      </div>

      <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)] lg:items-end">
        <div>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-secondary-fixed px-3 py-1 font-label text-[11px] font-black uppercase tracking-[0.18em] text-on-secondary-fixed">
              {schedule.competitionKind === 'TOURNAMENT' ? 'Tournament edition' : 'League season'}
            </span>
            <span className="font-label text-xs font-bold uppercase tracking-[0.16em] text-primary-fixed-dim">
              {schedule.timezoneLabel} schedule
            </span>
          </div>

          <h2 className="max-w-4xl font-headline text-4xl font-black uppercase leading-[0.92] tracking-[-0.045em] sm:text-5xl lg:text-7xl">
            {schedule.competitionName}
          </h2>
          <p className="mt-4 font-headline text-xl font-bold text-secondary-fixed sm:text-2xl">
            {schedule.editionLabel}
          </p>
          <p className="mt-5 max-w-2xl font-body text-sm leading-6 text-primary-fixed sm:text-base">
            {summary.dateRangeLabel
              ? `${summary.dateRangeLabel}. Browse every published fixture in official stage order, with times shown in the competition's venue timezone.`
              : 'The edition is published, but its fixture dates have not been released yet.'}
          </p>
        </div>

        <dl className="grid grid-cols-2 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-sm">
          {facts.map((fact, index) => (
            <div
              key={fact.label}
              className={`min-w-0 px-4 py-5 sm:px-5 ${index % 2 === 0 ? 'border-r border-white/10' : ''} ${index < 2 ? 'border-b border-white/10' : ''}`}
            >
              <dt className="font-label text-[10px] font-bold uppercase tracking-[0.16em] text-primary-fixed-dim">
                {fact.label}
              </dt>
              <dd className="mt-2 break-words font-headline text-xl font-black leading-tight text-white sm:text-2xl">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
