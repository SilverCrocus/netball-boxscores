import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { notFound, redirect } from 'next/navigation';
import { CourtClient } from './CourtClient';
import { hasResolvedMatchTeams } from '@/lib/edition-match';
import { isCanonicalMatchEdition, matchHref } from '@/lib/edition-links';
import { resolveEditionFeatures } from '@/lib/edition-capabilities';

interface Props {
  params: Promise<{ matchId: string }>;
  searchParams?: Promise<{ edition?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { matchId } = await params;
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });

  if (!match || !match.homeTeam || !match.awayTeam) return { title: 'Match Not Found' };

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

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      competition: {
        select: {
          dataCoverage: {
            where: { matchId: null },
            select: { capability: true, state: true },
          },
        },
      },
      dataCoverage: { select: { capability: true, state: true } },
      homeTeam: {
        include: {
          editionEntries: {
            select: {
              competitionId: true,
              roster: {
                where: { status: 'ACTIVE' },
                select: {
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
                where: { status: 'ACTIVE' },
                select: {
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
  });

  if (!match || !hasResolvedMatchTeams(match)) return notFound();

  const features = resolveEditionFeatures(match.competition.dataCoverage, match.dataCoverage);
  const canRenderCourt = (match.status === 'LIVE' || match.status === 'COMPLETED')
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

  function playersForTeam(team: NonNullable<NonNullable<typeof match>['homeTeam']>) {
    const entry = team.editionEntries.find(
      (candidate) => candidate.competitionId === competitionId,
    );
    return entry?.roster
      .filter((membership) => membership.validFrom <= scheduledAt
        && (membership.validTo === null || membership.validTo >= scheduledAt))
      .map((membership) => ({
        ...membership.player,
        position: membership.designatedPosition ?? membership.player.position,
      })) ?? [];
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
