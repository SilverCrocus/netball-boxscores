import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TournamentEmptyState } from '@/components/tournament/TournamentEmptyState';
import { TournamentPageHero } from '@/components/tournament/TournamentPageHero';
import { TournamentPools } from '@/components/tournament/TournamentPools';
import { TournamentSectionNav } from '@/components/tournament/TournamentSectionNav';
import { resolveEdition } from '@/lib/competitions';
import { toEditionContext } from '@/lib/edition-context';
import { getTournamentPools } from '@/lib/tournament';

interface PoolsPageProps {
  params: Promise<{
    competitionSlug: string;
    editionSlug: string;
  }>;
}

export async function generateMetadata({ params }: PoolsPageProps): Promise<Metadata> {
  const identity = await params;
  const { edition } = await resolveEdition(identity);
  if (!edition) return { title: 'Tournament Pools' };

  const editionName = edition.label ?? String(edition.season);
  return {
    title: `${editionName} Pools`,
    description: `Pool assignments and tournament seeds for ${edition.series?.name ?? edition.name} ${editionName}.`,
  };
}

export default async function PoolsPage({ params }: PoolsPageProps) {
  const identity = await params;
  const { edition } = await resolveEdition(identity);
  if (!edition) notFound();

  const overviewPromise = getTournamentPools(edition.id);
  const editionContext = toEditionContext(edition);
  const overview = await overviewPromise;

  return (
    <div>
      <TournamentSectionNav edition={editionContext} active="pools" />
      <TournamentPageHero
        eyebrow={overview?.stageName ?? 'Tournament format'}
        title="Tournament Pools"
        description="Every nation starts here. Pool assignments and seeds come directly from the selected competition edition, before the route narrows toward the medal matches."
        icon="groups"
        facts={overview ? [
          { label: 'Pools', value: String(overview.pools.length) },
          { label: 'Teams', value: String(overview.participantCount) },
        ] : []}
      />

      {overview && overview.pools.length > 0 ? (
        <TournamentPools pools={overview.pools} />
      ) : (
        <TournamentEmptyState
          icon="groups"
          title="No pool stage for this edition"
          description="This competition edition does not publish pool assignments. Use its overview for the format and available fixtures."
        />
      )}
    </div>
  );
}
