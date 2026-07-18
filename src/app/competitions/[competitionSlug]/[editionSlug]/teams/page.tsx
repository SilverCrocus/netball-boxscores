import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TeamBadge } from '@/components/ui/TeamBadge';
import { resolveEdition } from '@/lib/competitions';
import { getEditionTeams } from '@/lib/edition-teams';

interface EditionTeamsPageProps {
  params: Promise<{
    competitionSlug: string;
    editionSlug: string;
  }>;
}

export async function generateMetadata({
  params,
}: EditionTeamsPageProps): Promise<Metadata> {
  const identity = await params;
  const { edition } = await resolveEdition(identity);

  if (!edition) return { title: 'Competition Teams' };

  const editionLabel = edition.label ?? String(edition.season);
  return {
    title: `${editionLabel} Teams`,
    description: `Browse every team and available squad for ${edition.series?.name ?? edition.name} ${editionLabel}.`,
  };
}

export default async function EditionTeamsPage({ params }: EditionTeamsPageProps) {
  const identity = await params;
  const { edition } = await resolveEdition(identity);

  if (!edition) notFound();

  const entries = await getEditionTeams(edition.id);
  const editionLabel = edition.label ?? String(edition.season);
  const participantLabel = edition.series?.kind === 'TOURNAMENT' ? 'nations' : 'teams';

  return (
    <div>
      <section className="mb-10 rounded-3xl bg-primary px-6 py-10 text-white shadow-xl sm:px-10 md:py-14">
        <p className="font-label text-xs font-bold uppercase tracking-[0.2em] text-primary-fixed-dim">
          {editionLabel} participants
        </p>
        <h2 className="mt-3 font-headline text-4xl font-black uppercase tracking-tight sm:text-5xl md:text-6xl">
          Teams
        </h2>
        <p className="mt-4 max-w-2xl font-body text-base text-white/75 sm:text-lg">
          Browse the {entries.length} {participantLabel} competing in this edition and open each profile for its available squad and statistics.
        </p>
      </section>

      {entries.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {entries.map((entry) => (
            <Link
              key={entry.entryId}
              href={`/team/${entry.team.slug}?edition=${encodeURIComponent(edition.id)}`}
              prefetch={false}
              className="group rounded-2xl border border-outline-variant bg-surface-container-lowest p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-secondary hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
            >
              <div className="flex items-start gap-4">
                <TeamBadge
                  team={entry.team}
                  size={56}
                  variant="home"
                  className="shrink-0 rounded-2xl"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="font-headline text-lg font-bold text-primary transition-colors group-hover:text-secondary">
                    {entry.displayName}
                  </h3>
                  <p className="mt-1 font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant">
                    {entry.team.abbreviation}
                    {entry.poolName ? ` · ${entry.poolName}` : ''}
                  </p>
                  <p className="mt-3 font-body text-sm text-on-surface-variant">
                    {entry.rosterCount > 0
                      ? `${entry.rosterCount} squad players available`
                      : 'Squad awaiting publication'}
                  </p>
                </div>
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined text-outline-variant transition-colors group-hover:text-secondary"
                >
                  chevron_right
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-outline-variant bg-surface-container-low p-8 text-center">
          <span aria-hidden="true" className="material-symbols-outlined text-4xl text-outline">
            groups
          </span>
          <h3 className="mt-3 font-headline text-xl font-bold text-primary">
            Teams awaiting publication
          </h3>
          <p className="mt-2 font-body text-sm text-on-surface-variant">
            Participant details have not been published for this edition yet.
          </p>
        </div>
      )}
    </div>
  );
}
