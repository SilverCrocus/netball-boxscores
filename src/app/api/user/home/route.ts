import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { excludeSimData, prisma } from '@/lib/db';
import { resolveCompetition } from '@/lib/competitions';
import {
  homepageMatchSelect,
  publicHomepageMatchState,
  type ResolvedHomepageMatch,
} from '@/lib/home-feed';
import { hasResolvedMatchTeams } from '@/lib/edition-match';
import type { MyTeamHubItem, PersonalizedMatchCard } from '@/types/personalization';
import {
  resolvePublicMatchAccess,
  type PublicMatchAccess,
} from '@/lib/public-match';

export const dynamic = 'force-dynamic';

function toCard(
  match: ResolvedHomepageMatch,
  access: PublicMatchAccess,
): PersonalizedMatchCard {
  const publicState = publicHomepageMatchState(match, access);
  return {
    id: match.id,
    competitionId: match.competitionId,
    status: publicState.status,
    scoreAvailable: publicState.scoreAvailable,
    scheduledAt: match.scheduledAt.toISOString(),
    homeScore: publicState.homeScore,
    awayScore: publicState.awayScore,
    venue: match.venue,
    round: match.round,
    roundLabel: match.roundLabel,
    stageName: match.stage?.name ?? null,
    finalCode: match.finalCode,
    currentQuarter: publicState.currentQuarter,
    currentTime: publicState.currentTime,
    homeTeam: { id: match.homeTeamId, ...match.homeTeam },
    awayTeam: { id: match.awayTeamId, ...match.awayTeam },
    homeBreakdown: publicState.homeBreakdown,
    awayBreakdown: publicState.awayBreakdown,
  };
}

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const follows = await prisma.userTeam.findMany({
      where: { userId: auth.user.id },
      select: {
        teamId: true,
        team: { select: { id: true, name: true, abbreviation: true, logoUrl: true, primaryColor: true } },
      },
      orderBy: { team: { name: 'asc' } },
    });
    if (follows.length === 0) {
      return NextResponse.json([], { headers: { 'Cache-Control': 'private, no-store' } });
    }

    const { competition } = await resolveCompetition();
    if (!competition) {
      return NextResponse.json([], { headers: { 'Cache-Control': 'private, no-store' } });
    }

    const teamIds = follows.map((follow) => follow.teamId);
    const teamMatchFilter = {
      OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }],
    };
    const publicStageFilter = {
      OR: [
        { stageId: null },
        { stage: { is: { isPublished: true } } },
      ],
    };
    const [upcoming, completed] = await Promise.all([
      prisma.match.findMany({
        where: {
          ...excludeSimData,
          competitionId: competition.id,
          status: 'SCHEDULED',
          scheduledAt: { gte: new Date() },
          AND: [teamMatchFilter, publicStageFilter],
        },
        select: homepageMatchSelect,
        orderBy: { scheduledAt: 'asc' },
      }),
      prisma.match.findMany({
        where: {
          ...excludeSimData,
          competitionId: competition.id,
          status: 'COMPLETED',
          resultQuality: { in: ['UNOFFICIAL_FINAL', 'OFFICIAL_FINAL', 'CORRECTED'] },
          AND: [teamMatchFilter, publicStageFilter],
        },
        select: homepageMatchSelect,
        orderBy: { scheduledAt: 'desc' },
      }),
    ]);

    const [upcomingAccess, completedAccess] = await Promise.all([
      Promise.all(upcoming.map(async (match) => ({
        match,
        access: await resolvePublicMatchAccess(match.id).catch(() => null),
      }))),
      Promise.all(completed.map(async (match) => ({
        match,
        access: await resolvePublicMatchAccess(match.id).catch(() => null),
      }))),
    ]);
    const resolvedUpcoming = upcomingAccess.flatMap(({ match, access }) => (
      access && hasResolvedMatchTeams(match) ? [{ match, access }] : []
    ));
    const resolvedCompleted = completedAccess.flatMap(({ match, access }) => (
      access && hasResolvedMatchTeams(match) ? [{ match, access }] : []
    ));
    const items: MyTeamHubItem[] = follows.map((follow) => {
      const nextMatch = resolvedUpcoming.find(
        ({ match }) => match.homeTeamId === follow.teamId || match.awayTeamId === follow.teamId,
      );
      const latestResult = resolvedCompleted.find(
        ({ match }) => match.homeTeamId === follow.teamId || match.awayTeamId === follow.teamId,
      );
      return {
        team: follow.team,
        nextMatch: nextMatch ? toCard(nextMatch.match, nextMatch.access) : null,
        latestResult: latestResult ? toCard(latestResult.match, latestResult.access) : null,
      };
    });

    return NextResponse.json(items, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json(
      { error: { code: 'MY_TEAMS_UNAVAILABLE', message: 'Your teams are temporarily unavailable.', retryable: true } },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
