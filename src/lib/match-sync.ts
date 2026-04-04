import { prisma } from '@/lib/db';
import type { MatchStatus } from '@prisma/client';
import type { CDFixtureMatch } from '@/types/champion-data';
import { pickStatFields, type StatValues } from '@/lib/stat-utils';

interface ChampionDataMatchState {
  matchId: number; // championDataMatchId
  homeScore: number;
  awayScore: number;
  status: string;
  currentQuarter: number;
  currentTime: string;
  playerStats?: Array<StatValues & { championDataPlayerId: number }>;
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

  // ── Scorer attribution: read old goals BEFORE upserting stats ──
  // Maps teamId → [{playerId, name}] for players whose goals increased
  const scorersByTeam = new Map<string, Array<{ playerId: string; name: string }>>();

  // Upsert player stats
  if (incoming.playerStats && incoming.playerStats.length > 0) {
    const players = await prisma.player.findMany({
      where: {
        championDataPlayerId: {
          in: incoming.playerStats.map((ps) => ps.championDataPlayerId),
        },
      },
      select: { id: true, name: true, championDataPlayerId: true, teamId: true },
    });
    const playerMap = new Map(
      players.map((p) => [p.championDataPlayerId, p]),
    );

    // Snapshot current goals before overwrite
    const oldStats = await prisma.playerMatchStats.findMany({
      where: { matchId: changes.matchId },
      select: { playerId: true, goals: true },
    });
    const oldGoalMap = new Map(oldStats.map((s) => [s.playerId, s.goals]));

    const upserts = incoming.playerStats
      .filter((ps) => playerMap.has(ps.championDataPlayerId))
      .map((ps) => {
        const player = playerMap.get(ps.championDataPlayerId)!;
        const statsData = pickStatFields(ps);

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

    // Build scorer queues from goal diffs
    for (const ps of incoming.playerStats) {
      const player = playerMap.get(ps.championDataPlayerId);
      if (!player) continue;
      const oldGoals = oldGoalMap.get(player.id) ?? 0;
      const newGoals = ps.goals - oldGoals;
      if (newGoals > 0) {
        const queue = scorersByTeam.get(player.teamId) ?? [];
        for (let i = 0; i < newGoals; i++) {
          queue.push({ playerId: player.id, name: player.name });
        }
        scorersByTeam.set(player.teamId, queue);
      }
    }
  }

  // Upsert score flow (with scorer attribution for new entries)
  if (incoming.scoreFlow && incoming.scoreFlow.length > 0) {
    // Identify which entries already exist so we only attribute new ones
    const existing = await prisma.scoreFlow.findMany({
      where: { matchId: changes.matchId },
      select: { period: true, periodSeconds: true },
    });
    const existingKeys = new Set(
      existing.map((sf) => `${sf.period}-${sf.periodSeconds}`),
    );

    const scorerIdx = new Map<string, number>();

    for (const sf of incoming.scoreFlow) {
      const isNew = !existingKeys.has(`${sf.period}-${sf.periodSeconds}`);

      // Pop next scorer for this team (best-effort chronological match)
      let scorerPlayerId: string | undefined;
      if (isNew) {
        const teamId = sf.scoringTeamPrismaId;
        const queue = scorersByTeam.get(teamId);
        if (queue) {
          const idx = scorerIdx.get(teamId) ?? 0;
          if (idx < queue.length) {
            scorerPlayerId = queue[idx].playerId;
            scorerIdx.set(teamId, idx + 1);
          }
        }
      }

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
          scorePoints: sf.scorepoints,
          scorerPlayerId: scorerPlayerId ?? null,
        },
      });
    }
  }
}

/**
 * Reconcile matches where CD reports "complete" but DB still has LIVE or SCHEDULED.
 * Handles both the normal LIVE→COMPLETED transition and the case where the worker
 * missed the live window entirely (SCHEDULED→COMPLETED).
 */
export async function reconcileCompletedMatches(
  fixtureMatches: CDFixtureMatch[]
): Promise<Array<{ matchId: string; homeScore: number; awayScore: number; finalQuarter: number }>> {
  const unresolvedMatches = await prisma.match.findMany({
    where: { status: { in: ['LIVE', 'SCHEDULED'] } },
    select: { id: true, status: true, championDataMatchId: true },
  });

  if (unresolvedMatches.length === 0) return [];

  const fixtureMap = new Map(
    fixtureMatches.map((fm) => [fm.matchId, fm])
  );

  const completed: Array<{ matchId: string; homeScore: number; awayScore: number; finalQuarter: number }> = [];

  for (const dbMatch of unresolvedMatches) {
    if (!dbMatch.championDataMatchId) continue;

    const fixture = fixtureMap.get(dbMatch.championDataMatchId);
    if (!fixture || fixture.matchStatus.toLowerCase() !== 'complete') continue;

    await prisma.match.update({
      where: { id: dbMatch.id },
      data: {
        status: 'COMPLETED',
        homeScore: fixture.homeSquadScore,
        awayScore: fixture.awaySquadScore,
      },
    });

    completed.push({
      matchId: dbMatch.id,
      homeScore: fixture.homeSquadScore,
      awayScore: fixture.awaySquadScore,
      finalQuarter: fixture.periodCompleted || fixture.period || 4,
    });
  }

  return completed;
}
