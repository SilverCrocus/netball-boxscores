import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { notFound, redirect } from 'next/navigation';
import { CourtClient } from './CourtClient';
import { hasResolvedMatchTeams } from '@/lib/edition-match';
import { isCanonicalMatchEdition, matchHref } from '@/lib/edition-links';
import { isFinalFixture } from '@/lib/edition-capabilities';
import { resolvePublicMatchForRequest } from '@/lib/public-match';
import { rosterForMatch } from '@/lib/match-player-team';

interface Props {
  params: Promise<{ matchId: string }>;
  searchParams?: Promise<{ edition?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { matchId } = await params;
  const [match, publicAccess] = await Promise.all([
    prisma.match.findUnique({
      where: { id: matchId },
      select: {
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
      },
    }),
    resolvePublicMatchForRequest(matchId),
  ]);

  if (!match || !publicAccess || !match.homeTeam || !match.awayTeam) notFound();

  return {
    title: `Court View: ${match.homeTeam.name} vs ${match.awayTeam.name}`,
    robots: { index: false },
  };
}

export default async function CourtPage({ params, searchParams }: Props) {
  const [{ matchId }, query] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<{ edition?: string }>({}),
  ]);

  const [match, publicAccess] = await Promise.all([prisma.match.findUnique({
    where: { id: matchId },
    include: {
      homeTeam: {
        include: {
          editionEntries: {
            select: {
              competitionId: true,
              roster: {
                select: {
                  status: true,
                  validFrom: true,
                  validTo: true,
                  designatedPosition: true,
                  player: {
                    include: { matchStats: { where: { matchId } } },
                  },
                },
              },
            },
          },
        },
      },
      awayTeam: {
        include: {
          editionEntries: {
            select: {
              competitionId: true,
              roster: {
                select: {
                  status: true,
                  validFrom: true,
                  validTo: true,
                  designatedPosition: true,
                  player: {
                    include: { matchStats: { where: { matchId } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  }), resolvePublicMatchForRequest(matchId)]);

  if (!match || !publicAccess || !hasResolvedMatchTeams(match)) return notFound();

  const features = publicAccess.features;
  const canRenderCourt = (match.status === 'LIVE'
      || isFinalFixture(match.status, match.resultQuality))
    && features.lineups.available
    && features.playerBoxScore.available;
  if (!canRenderCourt) {
    redirect(matchHref(match.id, match.competitionId));
  }
  if (!isCanonicalMatchEdition(query.edition, match.competitionId)) {
    redirect(matchHref(match.id, match.competitionId, 'court'));
  }

  const competitionId = match.competitionId;
  const scheduledAt = match.scheduledAt;
  const isLiveMatch = match.status === 'LIVE';

  function playersForTeam(team: NonNullable<NonNullable<typeof match>['homeTeam']>) {
    const entry = team.editionEntries.find(
      (candidate) => candidate.competitionId === competitionId,
    );
    return rosterForMatch(
      entry?.roster ?? [],
      scheduledAt,
      isLiveMatch,
    )
      .map((membership) => ({
        ...membership.player,
        position: membership.designatedPosition ?? membership.player.position,
      }));
  }

  return <CourtClient
    match={{
      ...match,
      homeTeam: { ...match.homeTeam, players: playersForTeam(match.homeTeam) },
      awayTeam: { ...match.awayTeam, players: playersForTeam(match.awayTeam) },
    }}
    realtimeEnabled={match.status === 'LIVE'}
  />;
}
