import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TournamentEmptyState } from '@/components/tournament/TournamentEmptyState';
import { EditionLeagueStandings } from '@/components/competition/EditionLeagueStandings';
import { TournamentPageHero } from '@/components/tournament/TournamentPageHero';
import { TournamentSectionNav } from '@/components/tournament/TournamentSectionNav';
import { TournamentStandings } from '@/components/tournament/TournamentStandings';
import { resolveEdition } from '@/lib/competitions';
import { toEditionContext } from '@/lib/edition-context';
import { getTournamentPoolStandings } from '@/lib/tournament';
import { getStandingsForCompetition } from '@/lib/cached-queries';

interface TournamentStandingsPageProps {
  params: Promise<{
    competitionSlug: string;
    editionSlug: string;
  }>;
}

export async function generateMetadata({ params }: TournamentStandingsPageProps): Promise<Metadata> {
  const identity = await params;
  const { edition } = await resolveEdition(identity);
  if (!edition) return { title: 'Tournament Standings' };

  const editionName = edition.label ?? String(edition.season);
  const isLeague = edition.series?.kind === 'LEAGUE';
  return {
    title: `${editionName} ${isLeague ? 'Standings' : 'Pool Standings'}`,
    description: `Official ${isLeague ? 'league' : 'pool'} standings for ${edition.series?.name ?? edition.name} ${editionName}.`,
  };
}

export default async function TournamentStandingsPage({ params }: TournamentStandingsPageProps) {
  const identity = await params;
  const { edition } = await resolveEdition(identity);
  if (!edition) notFound();

  if (edition.series?.kind === 'LEAGUE') {
    const standings = await getStandingsForCompetition(edition.id);
    return (
      <EditionLeagueStandings
        competitionId={edition.id}
        editionLabel={edition.label ?? String(edition.season)}
        standings={standings}
      />
    );
  }

  const overviewPromise = getTournamentPoolStandings(edition.id);
  const editionContext = toEditionContext(edition);
  const overview = await overviewPromise;

  const teamCount = overview?.pools.reduce((total, pool) => total + pool.rows.length, 0) ?? 0;

  return (
    <div>
      <TournamentSectionNav edition={editionContext} active="standings" />
      <TournamentPageHero
        eyebrow={overview?.hasAnyStandings ? 'Official results' : 'Pre-event table'}
        title="Pool Standings"
        description="Positions update from official stage standings. Until results exist, CentrePass keeps every statistical cell blank and shows the published tournament seed order instead."
        icon="leaderboard"
        facts={overview ? [
          { label: 'Pools', value: String(overview.pools.length) },
          { label: 'Teams', value: String(teamCount) },
        ] : []}
      />

      {overview && overview.pools.length > 0 ? (
        <TournamentStandings
          pools={overview.pools}
          hasAnyStandings={overview.hasAnyStandings}
        />
      ) : (
        <TournamentEmptyState
          icon="leaderboard"
          title="No pool standings for this edition"
          description="This edition does not use published pool tables. Check the edition overview for its competition format."
        />
      )}
    </div>
  );
}
