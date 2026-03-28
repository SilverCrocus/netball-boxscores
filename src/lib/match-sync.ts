import { prisma } from '@/lib/db';
import type { MatchStatus } from '@prisma/client';

interface ChampionDataMatchState {
  matchId: number; // championDataMatchId
  homeScore: number;
  awayScore: number;
  status: string;
  currentQuarter: number;
  currentTime: string;
  playerStats?: Array<{
    championDataPlayerId: number;
    goals: number;
    attempts: number;
    goalAssists: number;
    intercepts: number;
    deflections: number;
    rebounds: number;
    penalties: number;
    feeds: number;
    centrePassReceives: number;
    turnovers: number;
    minutesPlayed: number;
  }>;
  quarterScores?: Array<{
    quarter: number;
    homeScore: number;
    awayScore: number;
  }>;
  scoreFlow?: Array<{
    period: number;
    periodSeconds: number;
    squadId: number;
    scorepoints: number;
    homeScore: number;
    awayScore: number;
    scoringTeamPrismaId: string;
  }>;
}

interface ChangeResult {
  matchId: string;
  scoreChanged: boolean;
  statusChanged: boolean;
  timeChanged: boolean;
  newHomeScore: number;
  newAwayScore: number;
  newStatus: MatchStatus;
  currentQuarter: number;
  currentTime: string;
}

export async function detectChanges(
  incoming: ChampionDataMatchState
): Promise<ChangeResult> {
  const match = await prisma.match.findUnique({
    where: { championDataMatchId: incoming.matchId },
  });
  if (!match) {
    return {
      matchId: '',
      scoreChanged: false,
      statusChanged: false,
      timeChanged: false,
      newHomeScore: incoming.homeScore,
      newAwayScore: incoming.awayScore,
      newStatus: incoming.status as MatchStatus,
      currentQuarter: incoming.currentQuarter,
      currentTime: incoming.currentTime,
    };
  }

  const scoreChanged =
    match.homeScore !== incoming.homeScore ||
    match.awayScore !== incoming.awayScore;

  const statusChanged = match.status !== incoming.status;

  const timeChanged =
    match.currentQuarter !== incoming.currentQuarter ||
    match.currentTime !== incoming.currentTime;

  return {
    matchId: match.id,
    scoreChanged,
    statusChanged,
    timeChanged,
    newHomeScore: incoming.homeScore,
    newAwayScore: incoming.awayScore,
    newStatus: incoming.status as MatchStatus,
    currentQuarter: incoming.currentQuarter,
    currentTime: incoming.currentTime,
  };
}

export async function applyChanges(
  changes: ChangeResult,
  incoming: ChampionDataMatchState
): Promise<void> {
  if (!changes.matchId) return;

  // Update match record
  if (changes.scoreChanged || changes.statusChanged || changes.timeChanged) {
    await prisma.match.update({
      where: { id: changes.matchId },
      data: {
        homeScore: changes.newHomeScore,
        awayScore: changes.newAwayScore,
        status: changes.newStatus,
        currentQuarter: changes.currentQuarter,
        currentTime: changes.currentTime,
      },
    });
  }

  // Upsert quarter scores
  if (incoming.quarterScores) {
    for (const qs of incoming.quarterScores) {
      await prisma.matchQuarter.upsert({
        where: {
          matchId_quarter: {
            matchId: changes.matchId,
            quarter: qs.quarter,
          },
        },
        update: {
          homeScore: qs.homeScore,
          awayScore: qs.awayScore,
        },
        create: {
          matchId: changes.matchId,
          quarter: qs.quarter,
          homeScore: qs.homeScore,
          awayScore: qs.awayScore,
        },
      });
    }
  }

  // Upsert player stats
  if (incoming.playerStats && incoming.playerStats.length > 0) {
    const players = await prisma.player.findMany({
      where: {
        championDataPlayerId: {
          in: incoming.playerStats.map((ps) => ps.championDataPlayerId),
        },
      },
    });
    const playerMap = new Map(
      players.map((p) => [p.championDataPlayerId, p]),
    );

    const upserts = incoming.playerStats
      .filter((ps) => playerMap.has(ps.championDataPlayerId))
      .map((ps) => {
        const player = playerMap.get(ps.championDataPlayerId)!;
        const statsData = {
          goals: ps.goals,
          attempts: ps.attempts,
          goalAssists: ps.goalAssists,
          intercepts: ps.intercepts,
          deflections: ps.deflections,
          rebounds: ps.rebounds,
          penalties: ps.penalties,
          feeds: ps.feeds,
          centrePassReceives: ps.centrePassReceives,
          turnovers: ps.turnovers,
          minutesPlayed: ps.minutesPlayed,
        };

        return prisma.playerMatchStats.upsert({
          where: {
            playerId_matchId: {
              playerId: player.id,
              matchId: changes.matchId,
            },
          },
          update: statsData,
          create: {
            playerId: player.id,
            matchId: changes.matchId,
            ...statsData,
          },
        });
      });

    await prisma.$transaction(upserts);
  }

  // Upsert score flow
  if (incoming.scoreFlow && incoming.scoreFlow.length > 0) {
    for (const sf of incoming.scoreFlow) {
      await prisma.scoreFlow.upsert({
        where: {
          matchId_period_periodSeconds: {
            matchId: changes.matchId,
            period: sf.period,
            periodSeconds: sf.periodSeconds,
          },
        },
        update: {
          homeScore: sf.homeScore,
          awayScore: sf.awayScore,
        },
        create: {
          matchId: changes.matchId,
          period: sf.period,
          periodSeconds: sf.periodSeconds,
          scoringTeamId: sf.scoringTeamPrismaId,
          homeScore: sf.homeScore,
          awayScore: sf.awayScore,
        },
      });
    }
  }
}
