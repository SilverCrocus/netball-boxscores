import { NextResponse } from 'next/server';
import { prisma, excludeSimData } from '@/lib/db';
import { formatMatchStage } from '@/lib/match-label';
import type { SearchResponse } from '@/types/search';
import { hasResolvedLegacyMatch } from '@/lib/edition-match';
import { getPublicCompetitions } from '@/lib/competitions';

export const dynamic = 'force-dynamic';

const EMPTY_RESULTS: SearchResponse = { players: [], teams: [], matches: [] };

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (query.length < 2) return NextResponse.json(EMPTY_RESULTS);
  if (query.length > 80) {
    return NextResponse.json(
      { error: { code: 'QUERY_TOO_LONG', message: 'Search queries are limited to 80 characters.', retryable: false } },
      { status: 400 },
    );
  }

  try {
    const publicEditionIds = (await getPublicCompetitions()).map((edition) => edition.id);
    const [players, teams, matches] = await Promise.all([
      prisma.player.findMany({
        where: {
          name: { contains: query, mode: 'insensitive' },
          OR: [
            { team: { competitionId: { in: publicEditionIds } } },
            { rosterMemberships: { some: { editionEntry: { competitionId: { in: publicEditionIds } } } } },
          ],
        },
        select: { id: true, name: true, position: true, team: { select: { name: true } } },
        orderBy: { name: 'asc' },
        take: 5,
      }),
      prisma.team.findMany({
        where: {
          AND: [
            { OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { abbreviation: { contains: query, mode: 'insensitive' } },
            ] },
            { OR: [
              { competitionId: { in: publicEditionIds } },
              { editionEntries: { some: { competitionId: { in: publicEditionIds } } } },
            ] },
          ],
        },
        select: { id: true, name: true, slug: true, abbreviation: true },
        orderBy: { name: 'asc' },
        take: 5,
      }),
      prisma.match.findMany({
        where: {
          ...excludeSimData,
          competitionId: { in: publicEditionIds },
          OR: [
            { homeTeam: { name: { contains: query, mode: 'insensitive' } } },
            { awayTeam: { name: { contains: query, mode: 'insensitive' } } },
            { venue: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          homeTeamId: true,
          awayTeamId: true,
          round: true,
          finalCode: true,
          status: true,
          homeScore: true,
          awayScore: true,
          homeTeam: { select: { name: true } },
          awayTeam: { select: { name: true } },
        },
        orderBy: { scheduledAt: 'desc' },
        take: 5,
      }),
    ]);

    return NextResponse.json({
      players: players.map((player) => ({
        id: player.id,
        kind: 'player' as const,
        label: player.name,
        meta: `${player.position} · ${player.team.name}`,
        href: `/player/${player.id}`,
      })),
      teams: teams.map((team) => ({
        id: team.id,
        kind: 'team' as const,
        label: team.name,
        meta: team.abbreviation,
        href: `/team/${team.slug}`,
      })),
      matches: matches.filter(hasResolvedLegacyMatch).map((match) => ({
        id: match.id,
        kind: 'match' as const,
        label: `${match.homeTeam.name} v ${match.awayTeam.name}`,
        meta: match.status === 'COMPLETED'
          ? `${match.homeScore}-${match.awayScore} · ${formatMatchStage(match.round, match.finalCode)}`
          : formatMatchStage(match.round, match.finalCode),
        href: match.status === 'LIVE' ? `/match/${match.id}/live` : `/match/${match.id}`,
      })),
    } satisfies SearchResponse);
  } catch {
    return NextResponse.json(
      { error: { code: 'SEARCH_UNAVAILABLE', message: 'Search is temporarily unavailable.', retryable: true } },
      { status: 503 },
    );
  }
}
