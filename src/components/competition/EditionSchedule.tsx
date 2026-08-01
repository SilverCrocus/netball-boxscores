import type { EditionSchedule as EditionScheduleModel } from '@/lib/edition-schedule';
import { TournamentMatchCard } from './TournamentMatchCard';

interface EditionScheduleProps {
  schedule: EditionScheduleModel;
  presentationMode?: 'public' | 'draft-preview';
}

function stageTypeLabel(type: string | null): string {
  if (!type) return 'Schedule';
  return type.replaceAll('_', ' ').toLocaleLowerCase('en-AU');
}

export function EditionSchedule({ schedule, presentationMode = 'public' }: EditionScheduleProps) {
  if (schedule.stages.length === 0) {
    return (
      <section className="rounded-2xl border border-outline-variant bg-surface-container-lowest px-6 py-14 text-center shadow-sm">
        <span className="material-symbols-outlined text-4xl text-secondary" aria-hidden="true">event_upcoming</span>
        <h2 className="mt-3 font-headline text-2xl font-black text-primary">
          {presentationMode === 'draft-preview' ? 'No imported fixtures' : 'Schedule awaiting publication'}
        </h2>
        <p className="mx-auto mt-2 max-w-xl font-body text-sm leading-6 text-on-surface-variant">
          {presentationMode === 'draft-preview'
            ? 'The private DRAFT query returned no non-simulation fixtures.'
            : 'This edition is available, but there are no published fixtures to display yet.'}
        </p>
      </section>
    );
  }

  const timezoneDescription = schedule.timezoneLabel === schedule.displayTimezone
    ? schedule.displayTimezone
    : `${schedule.timezoneLabel}, ${schedule.displayTimezone}`;

  return (
    <section aria-labelledby="edition-schedule-heading">
      <header className="mb-7 flex flex-col gap-5 border-b border-outline-variant pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-label text-xs font-black uppercase tracking-[0.18em] text-secondary">
            Official fixture order
          </p>
          <h2 id="edition-schedule-heading" className="mt-2 font-headline text-3xl font-black uppercase tracking-tight text-primary sm:text-4xl">
            Full schedule
          </h2>
          <p className="mt-2 max-w-2xl font-body text-sm leading-6 text-on-surface-variant">
            All times are shown in Sydney time ({timezoneDescription}).
            Scheduled fixtures do not display a score until play begins.
          </p>
        </div>

        {schedule.stages.length > 1 && (
          <nav aria-label="Schedule stages" className="flex max-w-full gap-2 overflow-x-auto pb-1">
            {schedule.stages.map((stage) => (
              <a
                key={stage.id}
                href={`#stage-${stage.slug}`}
                className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-outline-variant bg-surface-container-lowest px-4 font-label text-xs font-black uppercase tracking-wider text-primary transition-colors hover:border-secondary hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
              >
                {stage.name}
              </a>
            ))}
          </nav>
        )}
      </header>

      <div className="space-y-14">
        {schedule.stages.map((stage, stageIndex) => (
          <section
            id={`stage-${stage.slug}`}
            key={stage.id}
            aria-labelledby={`stage-${stage.slug}-heading`}
            className="scroll-mt-24 [content-visibility:auto] [contain-intrinsic-size:0_520px]"
          >
            <header className="mb-7 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
              <span className="font-headline text-5xl font-black leading-none text-surface-container-highest" aria-hidden="true">
                {String(stageIndex + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 border-l-2 border-secondary pl-4">
                <p className="font-label text-[10px] font-black uppercase tracking-[0.16em] text-on-surface-variant">
                  {stageTypeLabel(stage.type)} · {stage.fixtureCount} {stage.fixtureCount === 1 ? 'fixture' : 'fixtures'}
                </p>
                <h3 id={`stage-${stage.slug}-heading`} className="mt-1 break-words font-headline text-2xl font-black uppercase tracking-tight text-primary [overflow-wrap:anywhere]">
                  {stage.name}
                </h3>
              </div>
            </header>

            <div className="space-y-9">
              {stage.dates.map((date) => (
                <section key={date.key} aria-labelledby={`schedule-date-${stage.slug}-${date.key}`}>
                  <h4
                    id={`schedule-date-${stage.slug}-${date.key}`}
                    className="mb-4 flex items-center gap-3 font-headline text-base font-black uppercase tracking-tight text-primary sm:text-lg"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-secondary" aria-hidden="true" />
                    {date.label}
                  </h4>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {date.fixtures.map((fixture) => (
                      <TournamentMatchCard
                        key={fixture.id}
                        fixture={fixture}
                        presentationMode={presentationMode}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
