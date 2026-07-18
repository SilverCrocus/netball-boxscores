import { EditionHero } from '@/components/competition/EditionHero';
import { EditionSchedule } from '@/components/competition/EditionSchedule';
import { TournamentBracket } from '@/components/tournament/TournamentBracket';
import { TournamentPools } from '@/components/tournament/TournamentPools';
import { TeamBadge } from '@/components/ui/TeamBadge';
import type { GlasgowDraftPreviewData } from '@/lib/glasgow/draft-preview';

interface GlasgowDraftPreviewProps {
  data: GlasgowDraftPreviewData;
}

export function GlasgowDraftPreview({ data }: GlasgowDraftPreviewProps) {
  return (
    <div className="mx-auto max-w-7xl space-y-14 pb-16" data-testid="glasgow-draft-preview">
      <aside className="rounded-2xl border-2 border-amber-500 bg-amber-50 px-5 py-4 text-amber-950 shadow-sm" role="alert">
        <p className="font-headline text-lg font-black uppercase tracking-wide">
          Private DRAFT preview
        </p>
        <p className="mt-1 font-body text-sm">
          Restricted operator view. This edition and every surface below remain unpublished and read-only.
        </p>
      </aside>

      <EditionHero schedule={data.schedule} presentationMode="draft-preview" />

      <section aria-labelledby="draft-preview-integrity-heading">
        <h2 id="draft-preview-integrity-heading" className="font-headline text-3xl font-black uppercase text-primary">
          Preview integrity
        </h2>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Publication', data.edition.publicationStatus],
            ['Unpublished stages', String(data.edition.unpublishedStageCount)],
            ['Active rosters', String(data.activeRosterCount)],
            ['Simulation matches', 'Excluded'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5">
              <dt className="font-label text-[10px] font-black uppercase tracking-wider text-on-surface-variant">{label}</dt>
              <dd className="mt-2 font-headline text-2xl font-black text-primary">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <EditionSchedule schedule={data.schedule} presentationMode="draft-preview" />

      {data.pools ? (
        <section aria-labelledby="draft-preview-pools-heading">
          <h2 id="draft-preview-pools-heading" className="mb-6 font-headline text-3xl font-black uppercase text-primary">
            Pools
          </h2>
          <TournamentPools pools={data.pools.pools} />
        </section>
      ) : null}

      {data.bracket.length > 0 ? (
        <section aria-labelledby="draft-preview-bracket-heading">
          <h2 id="draft-preview-bracket-heading" className="mb-6 font-headline text-3xl font-black uppercase text-primary">
            Bracket
          </h2>
          <TournamentBracket stages={data.bracket} sourceTimezone={data.schedule.sourceTimezone} />
        </section>
      ) : null}

      <section aria-labelledby="draft-preview-rosters-heading">
        <header className="mb-6">
          <p className="font-label text-xs font-black uppercase tracking-[0.18em] text-secondary">
            Read-only squad check
          </p>
          <h2 id="draft-preview-rosters-heading" className="mt-2 font-headline text-3xl font-black uppercase text-primary">
            Teams and active rosters
          </h2>
        </header>
        <div className="grid gap-6 lg:grid-cols-2">
          {data.rosters.map((entry) => (
            <article key={entry.id} className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
              <header className="flex items-center gap-4 border-b border-surface-container pb-4">
                <TeamBadge team={entry.team} size={52} />
                <div>
                  <h3 className="font-headline text-xl font-black text-primary">
                    {entry.displayName?.trim() || entry.team.name}
                  </h3>
                  <p className="font-label text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                    {entry.primaryGroup?.name ?? 'Pool pending'} · {entry.roster.length} active players
                  </p>
                </div>
              </header>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {entry.roster.map((membership) => (
                  <li key={membership.id} className="rounded-xl bg-surface-container-low px-3 py-3">
                    <p className="font-headline text-sm font-bold text-primary">{membership.player.name}</p>
                    <p className="mt-1 font-label text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">
                      {membership.designatedPosition ?? membership.player.position}
                      {membership.bib ? ` · Bib ${membership.bib}` : ''}
                      {membership.isCaptain ? ' · Captain' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
