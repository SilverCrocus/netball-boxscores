import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { notFound, redirect } from 'next/navigation';
import { LiveGameClient } from './LiveGameClient';
import { pickStatFields, emptyStats } from '@/lib/stat-utils';
import { computeTeamStrengthPrior } from '@/lib/win-probability';
import { formatMatchStage } from '@/lib/match-label';
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
      status: true,
      homeTeamId: true,
      awayTeamId: true,
      round: true,
      roundLabel: true,
      finalCode: true,
      stage: { select: { name: true } },
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });

  if (!match || !hasResolvedMatchTeams(match)) return { title: 'Match Not Found' };

  const statusPrefix = match.status === 'COMPLETED'
    ? 'Full Time:'
    : match.status === 'LIVE'
      ? 'LIVE:'
      : 'Scheduled:';

  return {
    title: `${statusPrefix} ${match.homeTeam.name} vs ${match.awayTeam.name} | ${formatMatchStage(match.round, match.finalCode, match.roundLabel, match.stage?.name)}`,
    robots: { index: false },
  };
}

export default async function LiveGamePage({ params, searchParams }: Props) {
  const [{ matchId }, query] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<{ edition?: string }>({}),
  ]);

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      stage: { select: { name: true } },
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
                    include: {
                      matchStats: { where: { matchId } },
                    },
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
                    include: {
                      matchStats: { where: { matchId } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      quarters: { orderBy: { quarter: 'asc' } },
      scoreFlow: {
        orderBy: [
          { period: 'asc' },
          { periodSeconds: 'asc' },
          { homeScore: 'asc' },
          { awayScore: 'asc' },
          { scoringTeamId: 'asc' },
        ],
        select: {
          period: true,
          periodSeconds: true,
          scoringTeamId: true,
          homeScore: true,
          awayScore: true,
          scorePoints: true,
          scorerPlayer: { select: { id: true, name: true } },
        },
      },
      matchEvents: {
        orderBy: [{ period: 'asc' }, { periodSeconds: 'asc' }],
        select: {
          type: true,
          period: true,
          periodSeconds: true,
          playerId: true,
          player: { select: { name: true } },
          teamId: true,
          team: { select: { name: true, abbreviation: true, logoUrl: true } },
        },
      },
    },
  });

  if (!match || !hasResolvedMatchTeams(match)) return notFound();

  const features = resolveEditionFeatures(match.competition.dataCoverage, match.dataCoverage);
  const hasLiveDetail = features.playerBoxScore.available
    || features.scoreFlow.available
    || features.matchEvents.available;
  const canRenderLiveSurface = (match.status === 'LIVE' || match.status === 'COMPLETED')
    && features.finalScore.available
    && hasLiveDetail;
  if (!canRenderLiveSurface) {
    redirect(matchHref(match.id, match.competitionId));
  }
  if (!isCanonicalMatchEdition(query.edition, match.competitionId)) {
    redirect(matchHref(match.id, match.competitionId, 'live'));
  }

  const competitionId = match.competitionId;
  const scheduledAt = match.scheduledAt;

  function serializeTeam(team: NonNullable<NonNullable<typeof match>['homeTeam']>) {
    const entry = team.editionEntries.find(
      (candidate) => candidate.competitionId === competitionId,
    );
    const roster = entry?.roster.filter((membership) =>
      membership.validFrom <= scheduledAt
        && (membership.validTo === null || membership.validTo >= scheduledAt)
    ) ?? [];
    return {
      id: team.id,
      name: team.name,
      abbreviation: team.abbreviation,
      logoUrl: team.logoUrl,
      primaryColor: team.primaryColor,
      players: roster.map((membership) => {
        const player = membership.player;
        const stats = player.matchStats[0];
        return {
          id: player.id,
          name: player.name,
          position: membership.designatedPosition ?? player.position,
          ...(stats ? pickStatFields(stats) : emptyStats()),
        };
      }),
    };
  }

  // Compute pre-match team strength prior from season results
  const preMatchPrior = await computeTeamStrengthPrior(
    match.homeTeamId,
    match.awayTeamId,
    match.id,
  );

  const serialized = {
    id: match.id,
    competitionId: match.competitionId,
    round: match.round,
    roundLabel: match.roundLabel,
    stageName: match.stage?.name ?? null,
    finalCode: match.finalCode,
    venue: match.venue,
    status: match.status,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    currentQuarter: match.currentQuarter,
    currentTime: match.currentTime,
    homeTeam: serializeTeam(match.homeTeam),
    awayTeam: serializeTeam(match.awayTeam),
    quarters: match.quarters.map((q) => ({
      quarter: q.quarter,
      homeScore: q.homeScore,
      awayScore: q.awayScore,
    })),
    initialScoreFlow: features.scoreFlow.available ? match.scoreFlow.map((sf) => ({
      matchId: match.id,
      period: sf.period,
      periodSeconds: sf.periodSeconds,
      scoringTeamId: sf.scoringTeamId,
      homeScore: sf.homeScore,
      awayScore: sf.awayScore,
      scorePoints: sf.scorePoints,
      scorerPlayerId: sf.scorerPlayer?.id,
      scorerName: sf.scorerPlayer?.name,
    })) : [],
    initialMatchEvents: features.matchEvents.available ? match.matchEvents.map((e) => ({
      type: e.type,
      period: e.period,
      periodSeconds: e.periodSeconds,
      playerId: e.playerId,
      playerName: e.player.name,
      teamId: e.teamId,
      teamName: e.team.name,
      teamAbbreviation: e.team.abbreviation,
      teamLogoUrl: e.team.logoUrl,
    })) : [],
    preMatchPrior,
  };

  return <LiveGameClient
    match={serialized}
    capabilities={{
      lineups: features.lineups.available && features.playerBoxScore.available,
      matchEvents: features.matchEvents.available,
      periodScores: features.periodScores.available,
      playerBoxScore: features.playerBoxScore.available,
      scoreFlow: features.scoreFlow.available,
      superShots: features.superShots.available,
    }}
    realtimeEnabled={match.status === 'LIVE'}
  />;
}
