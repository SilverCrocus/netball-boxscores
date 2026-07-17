import { unstable_cache } from 'next/cache';
import { excludeSimData, prisma } from '@/lib/db';
import { hasResolvedMatchTeams } from '@/lib/edition-match';
import { getPublicCompetitions, type CompetitionOption } from '@/lib/competitions';
import {
  canExposePublicMatchScore,
  resolvePublicMatchAccessBatch,
} from '@/lib/public-match';

const matchTeamSelect = { name: true, abbreviation: true, logoUrl: true } as const;

function loadedEditionContext(
  competitionId: string,
  loadedEdition?: CompetitionOption,
): readonly CompetitionOption[] | undefined {
  if (!loadedEdition) return undefined;
  if (loadedEdition.id !== competitionId) {
    throw new RangeError(
      `Loaded edition ${loadedEdition.id} does not match competition ${competitionId}`,
    );
  }
  return [loadedEdition];
}

const standingsQuery = (competitionId: string) =>
  prisma.standing.findMany({
    where: { competitionId },
    include: {
      team: { select: { name: true, slug: true, abbreviation: true, logoUrl: true } },
    },
    orderBy: { rank: 'asc' },
  });

const teamsQuery = (publicEditionIds: string[]) => prisma.team.findMany({
  where: {
    OR: [
      { competitionId: { in: publicEditionIds } },
      { editionEntries: { some: { competitionId: { in: publicEditionIds } } } },
    ],
  },
  select: {
    id: true,
    name: true,
    slug: true,
    abbreviation: true,
    logoUrl: true,
  },
  orderBy: { name: 'asc' },
});

const teamBySlugQuery = (teamSlug: string, publicEditionIds: string[]) =>
  prisma.team.findFirst({
    where: {
      slug: teamSlug,
      OR: [
        { competitionId: { in: publicEditionIds } },
        {
          editionEntries: {
            some: {
              competitionId: { in: publicEditionIds },
              status: 'ACTIVE',
            },
          },
        },
      ],
    },
    include: {
      players: { orderBy: { name: 'asc' } },
      editionEntries: {
        where: {
          competitionId: { in: publicEditionIds },
          status: 'ACTIVE',
        },
        select: { competitionId: true },
      },
    },
  });

const teamStandingQuery = (competitionId: string, teamId: string) =>
  prisma.standing.findUnique({
    where: { competitionId_teamId: { competitionId, teamId } },
  });

const teamEditionRosterQuery = (competitionId: string, teamId: string) =>
  prisma.rosterMembership.findMany({
    where: {
      editionEntry: { competitionId, teamId, status: 'ACTIVE' },
      status: 'ACTIVE',
      validTo: null,
    },
    select: {
      designatedPosition: true,
      player: true,
    },
    orderBy: { player: { name: 'asc' } },
  });

const recentTeamMatchCandidatesQuery = (competitionId: string, teamId: string) =>
  prisma.match.findMany({
    where: {
      ...excludeSimData,
      competitionId,
      status: 'COMPLETED',
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    },
    include: {
      homeTeam: { select: matchTeamSelect },
      awayTeam: { select: matchTeamSelect },
    },
    orderBy: { scheduledAt: 'desc' },
    take: 15,
  });

const upcomingTeamMatchCandidatesQuery = (competitionId: string, teamId: string) =>
  prisma.match.findMany({
    where: {
      ...excludeSimData,
      competitionId,
      status: 'SCHEDULED',
      scheduledAt: { gte: new Date() },
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    },
    include: {
      homeTeam: { select: matchTeamSelect },
      awayTeam: { select: matchTeamSelect },
    },
    orderBy: { scheduledAt: 'asc' },
    take: 10,
  });

const getRecentTeamMatchCandidates = process.env.NODE_ENV === 'test'
  ? recentTeamMatchCandidatesQuery
  : unstable_cache(recentTeamMatchCandidatesQuery, ['recent-team-match-candidates-v1'], {
      revalidate: 900,
      tags: ['completed-match-history'],
    });

const getUpcomingTeamMatchCandidates = process.env.NODE_ENV === 'test'
  ? upcomingTeamMatchCandidatesQuery
  : unstable_cache(upcomingTeamMatchCandidatesQuery, ['upcoming-team-match-candidates-v1'], {
      revalidate: 60,
      tags: ['upcoming-matches'],
    });

export async function getRecentTeamMatches(
  competitionId: string,
  teamId: string,
  loadedEdition?: CompetitionOption,
) {
  const loadedEditions = loadedEditionContext(competitionId, loadedEdition);
  const candidates = await getRecentTeamMatchCandidates(competitionId, teamId);
  if (candidates.length === 0) return [];

  const accessByMatchId = await resolvePublicMatchAccessBatch(
    candidates.map((match) => match.id),
    loadedEditions,
  );

  return candidates
    .filter((match) => {
      const access = accessByMatchId.get(match.id);
      return access ? canExposePublicMatchScore(access) : false;
    })
    .filter(hasResolvedMatchTeams)
    .slice(0, 5);
}

export async function getUpcomingTeamMatches(
  competitionId: string,
  teamId: string,
  loadedEdition?: CompetitionOption,
) {
  const loadedEditions = loadedEditionContext(competitionId, loadedEdition);
  const candidates = await getUpcomingTeamMatchCandidates(competitionId, teamId);
  if (candidates.length === 0) return [];

  const accessByMatchId = await resolvePublicMatchAccessBatch(
    candidates.map((match) => match.id),
    loadedEditions,
  );

  return candidates
    .filter((match) => accessByMatchId.has(match.id))
    .filter(hasResolvedMatchTeams)
    .slice(0, 3);
}

export const getStandingsForCompetition = process.env.NODE_ENV === 'test'
  ? standingsQuery
  : unstable_cache(standingsQuery, ['standings-by-competition-v1'], {
      revalidate: 60,
      tags: ['standings'],
    });

const getTeamsForEditionIds = process.env.NODE_ENV === 'test'
  ? teamsQuery
  : unstable_cache(teamsQuery, ['team-directory-v1'], {
      revalidate: 3600,
      tags: ['teams'],
    });

const getTeamBySlugForEditionIds = process.env.NODE_ENV === 'test'
  ? teamBySlugQuery
  : unstable_cache(teamBySlugQuery, ['team-by-slug-v2'], {
      revalidate: 3600,
      tags: ['teams'],
    });

export async function getTeams() {
  const publicEditionIds = (await getPublicCompetitions()).map((edition) => edition.id);
  return getTeamsForEditionIds(publicEditionIds);
}

export async function getTeamBySlug(teamSlug: string) {
  const publicEditionIds = (await getPublicCompetitions()).map((edition) => edition.id);
  return getTeamBySlugForEditionIds(teamSlug, publicEditionIds);
}

export const getTeamStanding = process.env.NODE_ENV === 'test'
  ? teamStandingQuery
  : unstable_cache(teamStandingQuery, ['team-standing-v1'], {
      revalidate: 60,
      tags: ['standings'],
    });

export const getTeamEditionRoster = process.env.NODE_ENV === 'test'
  ? teamEditionRosterQuery
  : unstable_cache(teamEditionRosterQuery, ['team-edition-roster-v3'], {
      revalidate: 3600,
      tags: ['teams', 'rosters'],
    });
