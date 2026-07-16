import { unstable_cache } from 'next/cache';
import { excludeSimData, prisma } from '@/lib/db';
import { hasResolvedMatchTeams } from '@/lib/edition-match';
import { getPublicCompetitions } from '@/lib/competitions';

const matchTeamSelect = { name: true, abbreviation: true, logoUrl: true } as const;

const standingsQuery = (competitionId: string) =>
  prisma.standing.findMany({
    where: { competitionId },
    include: {
      team: { select: { name: true, slug: true, abbreviation: true, logoUrl: true } },
    },
    orderBy: { rank: 'asc' },
  });

const teamsQuery = async () => {
  const publicEditionIds = (await getPublicCompetitions()).map((edition) => edition.id);
  return prisma.team.findMany({
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
};

const teamBySlugQuery = async (teamSlug: string) => {
  const publicEditionIds = (await getPublicCompetitions()).map((edition) => edition.id);
  return prisma.team.findFirst({
    where: {
      slug: teamSlug,
      OR: [
        { competitionId: { in: publicEditionIds } },
        { editionEntries: { some: { competitionId: { in: publicEditionIds } } } },
      ],
    },
    include: { players: { orderBy: { name: 'asc' } } },
  });
};

const teamStandingQuery = (competitionId: string, teamId: string) =>
  prisma.standing.findUnique({
    where: { competitionId_teamId: { competitionId, teamId } },
  });

const recentTeamMatchesQuery = async (competitionId: string, teamId: string) => {
  const matches = await prisma.match.findMany({
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
    take: 5,
  });
  return matches.filter(hasResolvedMatchTeams);
};

const upcomingTeamMatchesQuery = async (competitionId: string, teamId: string) => {
  const matches = await prisma.match.findMany({
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
    take: 3,
  });
  return matches.filter(hasResolvedMatchTeams);
};

export const getStandingsForCompetition = process.env.NODE_ENV === 'test'
  ? standingsQuery
  : unstable_cache(standingsQuery, ['standings-by-competition-v1'], {
      revalidate: 60,
      tags: ['standings'],
    });

export const getTeams = process.env.NODE_ENV === 'test'
  ? teamsQuery
  : unstable_cache(teamsQuery, ['team-directory-v1'], {
      revalidate: 3600,
      tags: ['teams'],
    });

export const getTeamBySlug = process.env.NODE_ENV === 'test'
  ? teamBySlugQuery
  : unstable_cache(teamBySlugQuery, ['team-by-slug-v1'], {
      revalidate: 3600,
      tags: ['teams'],
    });

export const getTeamStanding = process.env.NODE_ENV === 'test'
  ? teamStandingQuery
  : unstable_cache(teamStandingQuery, ['team-standing-v1'], {
      revalidate: 60,
      tags: ['standings'],
    });

export const getRecentTeamMatches = process.env.NODE_ENV === 'test'
  ? recentTeamMatchesQuery
  : unstable_cache(recentTeamMatchesQuery, ['recent-team-matches-v1'], {
      revalidate: 900,
      tags: ['completed-match-history'],
    });

export const getUpcomingTeamMatches = process.env.NODE_ENV === 'test'
  ? upcomingTeamMatchesQuery
  : unstable_cache(upcomingTeamMatchesQuery, ['upcoming-team-matches-v1'], {
      revalidate: 60,
      tags: ['upcoming-matches'],
    });
