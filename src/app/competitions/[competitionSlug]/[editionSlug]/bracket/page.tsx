import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TournamentBracket } from '@/components/tournament/TournamentBracket';
import { TournamentEmptyState } from '@/components/tournament/TournamentEmptyState';
import { TournamentPageHero } from '@/components/tournament/TournamentPageHero';
import { TournamentSectionNav } from '@/components/tournament/TournamentSectionNav';
import { resolveEdition } from '@/lib/competitions';
import { toEditionContext } from '@/lib/edition-context';
import { SYDNEY_TIME_ZONE } from '@/lib/time-zone';
import { getTournamentBracket } from '@/lib/tournament';

interface BracketPageProps {
  params: Promise<{
    competitionSlug: string;
    editionSlug: string;
  }>;
}

export async function generateMetadata({ params }: BracketPageProps): Promise<Metadata> {
  const identity = await params;
  const { edition } = await resolveEdition(identity);
  if (!edition) return { title: 'Tournament Finals Path' };

  const editionName = edition.label ?? String(edition.season);
  return {
    title: `${editionName} Finals Path`,
    description: `Classification, semi-final, bronze medal, and gold medal fixtures for ${edition.series?.name ?? edition.name} ${editionName}.`,
  };
}

export default async function BracketPage({ params }: BracketPageProps) {
  const identity = await params;
  const { edition } = await resolveEdition(identity);
  if (!edition) notFound();

  const stagesPromise = getTournamentBracket(edition.id, edition);
  const editionContext = toEditionContext(edition);
  const stages = await stagesPromise;
  const matchCount = stages.reduce((total, stage) => total + stage.matches.length, 0);

  return (
    <div>
      <TournamentSectionNav edition={editionContext} active="bracket" />
      <TournamentPageHero
        eyebrow="Road to the podium"
        title="Finals Path"
        description="Classification places, semi-finals and medal matches stay unresolved until the competition decides them. CentrePass shows the official qualification route—never a made-up team or score."
        icon="account_tree"
        facts={stages.length > 0 ? [
          { label: 'Stages', value: String(stages.length) },
          { label: 'Matches', value: String(matchCount) },
        ] : []}
      />

      {stages.length > 0 ? (
        <>
          <div className="mb-5 flex items-center gap-2 font-label text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface-variant">
            <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-secondary">schedule</span>
            Times shown in Sydney time
          </div>
          <TournamentBracket stages={stages} displayTimezone={SYDNEY_TIME_ZONE} />
        </>
      ) : (
        <TournamentEmptyState
          icon="account_tree"
          title="No tournament bracket for this edition"
          description="Classification and medal fixtures have not been published for this competition edition."
        />
      )}
    </div>
  );
}
