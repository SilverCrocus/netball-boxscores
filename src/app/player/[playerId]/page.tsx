import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getStatValue, computeShootingPct } from '@/lib/stat-utils';
import { getPositionConfig } from '@/components/player/position-config';
import { PlayerHero } from '@/components/player/PlayerHero';
import { PlayerBioCard } from '@/components/player/PlayerBioCard';
import PlayerSeasonStats from '@/components/player/PlayerSeasonStats';
import PlayerCharts from '@/components/player/PlayerCharts';
import { PlayerGameLog } from '@/components/player/PlayerGameLog';
import { PlayerAdvancedMetrics } from '@/components/player/PlayerAdvancedMetrics';
import { getPlayerAnalyticsProfile } from '@/lib/player-analytics';
import { getPublicCompetitions, type CompetitionOption } from '@/lib/competitions';
import { JsonLd, personJsonLd, breadcrumbJsonLd } from '@/lib/seo';
import type { Metadata } from 'next';

interface PlayerPageProps {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<PlayerEditionSearchParams>;
}

interface PlayerEditionSearchParams {
  edition?: string;
  competition?: string;
  season?: string;
}

interface PlayerEditionSelection {
  competition: CompetitionOption | null;
  invalidExplicitSelection: boolean;
}

/**
 * Player pages are shared by league and tournament editions, so an explicit
 * selector must identify one public edition exactly. Canonical ids are
 * preferred; competition-qualified slugs remain available for routed links.
 * An unqualified slug is accepted only while it is globally unique.
 */
function selectPlayerEdition(
  competitions: readonly CompetitionOption[],
  { edition, competition, season }: PlayerEditionSearchParams,
): PlayerEditionSelection {
  if (!edition && !competition && !season) {
    return {
      competition: null,
      invalidExplicitSelection: false,
    };
  }

  if (edition) {
    if (competition) {
      const qualifiedMatches = competitions.filter((candidate) =>
        candidate.series?.slug === competition
          && (candidate.id === edition || candidate.slug === edition),
      );
      return {
        competition: qualifiedMatches.length === 1 ? qualifiedMatches[0] : null,
        invalidExplicitSelection: qualifiedMatches.length !== 1,
      };
    }

    const routeParts = edition.split('/');
    if (routeParts.length === 2 && routeParts.every(Boolean)) {
      const [competitionSlug, editionSlug] = routeParts;
      const qualifiedMatches = competitions.filter((candidate) =>
        candidate.series?.slug === competitionSlug && candidate.slug === editionSlug,
      );
      return {
        competition: qualifiedMatches.length === 1 ? qualifiedMatches[0] : null,
        invalidExplicitSelection: qualifiedMatches.length !== 1,
      };
    }

    const canonicalMatch = competitions.find((candidate) => candidate.id === edition);
    if (canonicalMatch) {
      return { competition: canonicalMatch, invalidExplicitSelection: false };
    }

    const slugMatches = competitions.filter((candidate) => candidate.slug === edition);
    return {
      competition: slugMatches.length === 1 ? slugMatches[0] : null,
      invalidExplicitSelection: slugMatches.length !== 1,
    };
  }

  if (competition) {
    return { competition: null, invalidExplicitSelection: true };
  }

  const leagueMatches = /^\d{4}$/.test(season ?? '')
    ? competitions.filter((candidate) =>
        candidate.series?.kind === 'LEAGUE' && candidate.season.toString() === season,
      )
    : [];
  return {
    competition: leagueMatches.length === 1 ? leagueMatches[0] : null,
    invalidExplicitSelection: leagueMatches.length !== 1,
  };
}

const getPlayerEditionIdentity = cache((playerId: string, publicEditionIds: string[]) =>
  prisma.player.findFirst({
    where: {
      id: playerId,
      OR: [
        { team: { competitionId: { in: publicEditionIds } } },
        {
          rosterMemberships: {
            some: {
              status: 'ACTIVE',
              validTo: null,
              editionEntry: {
                status: 'ACTIVE',
                competitionId: { in: publicEditionIds },
              },
            },
          },
        },
      ],
    },
    select: {
      team: { select: { competitionId: true } },
      rosterMemberships: {
        where: {
          status: 'ACTIVE',
          validTo: null,
          editionEntry: {
            status: 'ACTIVE',
            competitionId: { in: publicEditionIds },
          },
        },
        select: {
          editionEntry: { select: { competitionId: true } },
        },
      },
    },
  })
);

type PlayerEditionIdentity = NonNullable<Awaited<ReturnType<typeof getPlayerEditionIdentity>>>;

function playerBelongsToEdition(
  player: PlayerEditionIdentity,
  edition: CompetitionOption,
): boolean {
  const hasActiveRosterMembership = player.rosterMemberships.some(
    (membership) => membership.editionEntry.competitionId === edition.id,
  );
  const hasLegacyLeagueMembership = edition.series?.kind === 'LEAGUE'
    && player.team.competitionId === edition.id;

  return hasActiveRosterMembership || hasLegacyLeagueMembership;
}

const getPlayer = cache((playerId: string, competitionId: string | undefined, publicEditionIds: string[]) =>
  prisma.player.findFirst({
    where: {
      id: playerId,
      OR: [
        { team: { competitionId: { in: publicEditionIds } } },
        {
          rosterMemberships: {
            some: {
              status: 'ACTIVE',
              validTo: null,
              editionEntry: {
                status: 'ACTIVE',
                competitionId: { in: publicEditionIds },
              },
            },
          },
        },
      ],
    },
    include: {
      team: true,
      matchStats: {
        where: competitionId ? {
          match: {
            competitionId,
            status: 'COMPLETED',
            resultQuality: { in: ['OFFICIAL_FINAL', 'CORRECTED'] },
            isSimulation: false,
          },
        } : undefined,
        include: {
          match: {
            include: {
              homeTeam: true,
              awayTeam: true,
            },
          },
        },
        orderBy: { match: { scheduledAt: 'desc' } },
      },
      rosterMemberships: {
        where: {
          status: 'ACTIVE',
          validTo: null,
          editionEntry: competitionId
            ? { status: 'ACTIVE', competitionId }
            : { status: 'ACTIVE', competitionId: { in: publicEditionIds } },
        },
        include: { editionEntry: { include: { team: true, competition: true } } },
        orderBy: { validFrom: 'desc' },
      },
    },
  })
);

const getPlayerSuperShots = cache((playerId: string, matchIds: string[]) =>
  prisma.scoreFlow.groupBy({
    by: ['matchId'],
    where: { scorerPlayerId: playerId, scorePoints: 2, matchId: { in: matchIds } },
    _count: true,
  })
);

export async function generateMetadata({ params }: PlayerPageProps): Promise<Metadata> {
  const { playerId } = await params;
  const publicEditionIds = (await getPublicCompetitions()).map((edition) => edition.id);
  const player = await getPlayer(playerId, undefined, publicEditionIds);

  if (!player) return { title: 'Player Not Found' };

  return {
    title: `${player.name} - ${player.team.name}`,
    description: `${player.name} — ${player.position} for ${player.team.name}. Season stats, game log, and profile.`,
  };
}

type PlayerWithStats = NonNullable<Awaited<ReturnType<typeof getPlayer>>>;

function computeStatHighlightValues(
  player: PlayerWithStats,
  config: ReturnType<typeof getPositionConfig>,
): (number | string | null)[] {
  const { matchStats } = player;
  if (matchStats.length === 0) return config.highlights.map(() => null);

  return config.highlights.map((highlight) => {
    if (highlight.statField === 'shootingPct') {
      const totalGoals = matchStats.reduce((sum, s) => sum + s.goals, 0);
      const totalAttempts = matchStats.reduce((sum, s) => sum + s.attempts, 0);
      return computeShootingPct(totalGoals, totalAttempts).toFixed(1);
    }
    const total = matchStats.reduce(
      (sum, s) => sum + getStatValue(s, highlight.statField),
      0,
    );
    return total;
  });
}

export default async function PlayerPage({ params, searchParams }: PlayerPageProps) {
  const { playerId } = await params;
  const editionSearch = await searchParams;

  const competitions = await getPublicCompetitions();
  const selection = selectPlayerEdition(competitions, editionSearch);
  if (selection.invalidExplicitSelection) notFound();

  const publicEditionIds = competitions.map((competition) => competition.id);
  const playerEditionIdentity = await getPlayerEditionIdentity(playerId, publicEditionIds);
  if (!playerEditionIdentity) notFound();

  const playerCompetitions = competitions.filter((competition) =>
    playerBelongsToEdition(playerEditionIdentity, competition),
  );
  const selectedCompetition = selection.competition
    ?? playerCompetitions[0]
    ?? null;
  if (!selectedCompetition
    || !playerBelongsToEdition(playerEditionIdentity, selectedCompetition)) {
    notFound();
  }

  if (editionSearch.edition !== selectedCompetition.id) {
    redirect(
      `/player/${encodeURIComponent(playerId)}?edition=${encodeURIComponent(selectedCompetition.id)}`,
    );
  }

  const player = await getPlayer(
    playerId,
    selectedCompetition.id,
    publicEditionIds,
  );

  if (!player) notFound();

  const rosterMembership = player.rosterMemberships.find(
    (candidate) => candidate.editionEntry.competitionId === selectedCompetition.id,
  );
  const membership = rosterMembership?.editionEntry;
  const displayPosition = rosterMembership?.designatedPosition ?? player.position;
  const displayTeam = membership?.team ?? player.team;
  const displayPlayer = {
    ...player,
    position: displayPosition,
    team: displayTeam,
    teamId: displayTeam.id,
  };
  const config = getPositionConfig(displayPosition);
  const statHighlightValues = computeStatHighlightValues(player, config);

  const analytics = selectedCompetition
    ? await getPlayerAnalyticsProfile(playerId, selectedCompetition.id, displayPosition)
    : null;
  const superShotsByMatch = analytics?.superShotMatchIds.length
    ? await getPlayerSuperShots(playerId, analytics.superShotMatchIds)
    : [];
  const totalSuperShots = superShotsByMatch.reduce((sum, g) => sum + g._count, 0);
  const editionQuery = selectedCompetition
    ? `?edition=${encodeURIComponent(selectedCompetition.id)}`
    : '';

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <JsonLd data={personJsonLd({
        name: player.name,
        position: displayPosition,
        dateOfBirth: player.dateOfBirth,
        nationality: player.nationality,
        teamName: displayTeam.name,
        teamSlug: displayTeam.slug,
      })} />
      <JsonLd data={breadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: 'Teams', url: '/teams' },
        { name: displayTeam.name, url: `/team/${displayTeam.slug}${editionQuery}` },
        { name: player.name, url: `/player/${player.id}` },
      ])} />

      <PlayerHero
        player={displayPlayer}
        positionConfig={config}
        statHighlightValues={statHighlightValues}
        editionId={selectedCompetition?.id}
      />

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div className="md:col-span-8">
          <PlayerSeasonStats
            matchStats={player.matchStats}
            positionConfig={config}
            totalSuperShots={analytics?.superShotMatchIds.length ? totalSuperShots : undefined}
            competitions={playerCompetitions}
            selectedCompetitionId={selectedCompetition?.id}
            playerId={playerId}
          />
        </div>
        <div className="md:col-span-4">
          <PlayerCharts
            matchStats={player.matchStats}
            positionConfig={config}
          />
        </div>
      </div>

      {analytics && selectedCompetition && (
        <PlayerAdvancedMetrics
          analytics={analytics}
          editionLabel={selectedCompetition.label ?? selectedCompetition.name}
          membershipLabel={membership?.displayName ?? membership?.team.name ?? player.team.name}
        />
      )}

      <PlayerBioCard biography={player.biography ?? null} />

      <PlayerGameLog
        matchStats={player.matchStats}
        config={config}
        playerTeamId={displayTeam.id}
      />
    </div>
  );
}
