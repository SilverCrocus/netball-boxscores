import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { excludeSimData, prisma } from '@/lib/db';
import { resolveCompetition } from '@/lib/competitions';
import { computeBreakdown, homepageMatchSelect, type ResolvedHomepageMatch } from '@/lib/home-feed';
import { hasResolvedLegacyMatch } from '@/lib/edition-match';
import type { MyTeamHubItem, PersonalizedMatchCard } from '@/types/personalization';

export const dynamic = 'force-dynamic';

function toCard(match: ResolvedHomepageMatch): PersonalizedMatchCard {
  return {
    id: match.id,
    status: match.status,
    scheduledAt: match.scheduledAt.toISOString(),
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    venue: match.venue,
    round: match.round,
    finalCode: match.finalCode,
    currentQuarter: match.currentQuarter,
    currentTime: match.currentTime,
    homeTeam: { id: match.homeTeamId, ...match.homeTeam },
    awayTeam: { id: match.awayTeamId, ...match.awayTeam },
    ...computeBreakdown(match),
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
    const [upcoming, completed] = await Promise.all([
      prisma.match.findMany({
        where: {
          ...excludeSimData,
          competitionId: competition.id,
          status: 'SCHEDULED',
          scheduledAt: { gte: new Date() },
          ...teamMatchFilter,
        },
        select: homepageMatchSelect,
        orderBy: { scheduledAt: 'asc' },
      }),
      prisma.match.findMany({
        where: {
          ...excludeSimData,
          competitionId: competition.id,
          status: 'COMPLETED',
          ...teamMatchFilter,
        },
        select: homepageMatchSelect,
        orderBy: { scheduledAt: 'desc' },
      }),
    ]);

    const resolvedUpcoming = upcoming.filter(hasResolvedLegacyMatch);
    const resolvedCompleted = completed.filter(hasResolvedLegacyMatch);
    const items: MyTeamHubItem[] = follows.map((follow) => {
      const nextMatch = resolvedUpcoming.find(
        (match) => match.homeTeamId === follow.teamId || match.awayTeamId === follow.teamId,
      );
      const latestResult = resolvedCompleted.find(
        (match) => match.homeTeamId === follow.teamId || match.awayTeamId === follow.teamId,
      );
      return {
        team: follow.team,
        nextMatch: nextMatch ? toCard(nextMatch) : null,
        latestResult: latestResult ? toCard(latestResult) : null,
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
