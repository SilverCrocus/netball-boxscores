import { prisma } from '@/lib/db';
import { mapMatchStatus, fetchMatchStats } from '@/lib/champion-data';
import { pickStatFields, type StatValues } from '@/lib/stat-utils';
import type { MatchStatus } from '@prisma/client';
import type { CDFixtureMatch, CDMatchStatsResponse } from '@/types/champion-data';

// ── Types ──

interface TeamInfo {
  id: string;
  name: string;
}

interface PlayerInfo {
  id: string;
  name: string;
  teamId: string;
}

export interface ProcessedMatchState {
  cdMatchId: number;
  homeScore: number;
  awayScore: number;
  status: MatchStatus;
  currentQuarter: number;
  currentTime: string;
  quarterScores?: Array<{ quarter: number; homeScore: number; awayScore: number }>;
  playerStats?: Array<StatValues & { championDataPlayerId: number }>;
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

export interface ValidationResult {
  valid: boolean;
  scoreFlowValid: boolean;
  warnings: string[];
  errors: string[];
  validatedData: ProcessedMatchState | null;
}

export interface ChangeResult {
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

// ── Validation ──

const MAX_QUARTER_SECONDS = 960; // 15min (900s) + 60s buffer
const MAX_ET_SECONDS = 360;      // 5min (300s) + 60s buffer

export function validateMatchData(
  fixture: CDFixtureMatch,
  detail: CDMatchStatsResponse,
  dbTeams: Map<number, TeamInfo>,
  dbPlayers: Map<number, PlayerInfo>,
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let valid = true;
  let scoreFlowValid = true;

  // Team validation
  const homeTeam = dbTeams.get(detail.matchInfo.homeSquadId);
  const awayTeam = dbTeams.get(detail.matchInfo.awaySquadId);
  if (!homeTeam) {
    errors.push(`Home team squadId ${detail.matchInfo.homeSquadId} not found in DB`);
    valid = false;
  }
  if (!awayTeam) {
    errors.push(`Away team squadId ${detail.matchInfo.awaySquadId} not found in DB`);
    valid = false;
  }

  // Quarter validation
  const period = detail.matchInfo.period;
  if (period < 1) {
    errors.push(`Invalid period ${period} — must be >= 1`);
    valid = false;
  }

  // Time validation (clamp, don't reject)
  let periodSeconds = detail.matchInfo.periodSeconds;
  if (periodSeconds < 0) {
    warnings.push(`Negative periodSeconds ${periodSeconds} — clamp to 0`);
    periodSeconds = 0;
  }
  const maxSecs = period > 4 ? MAX_ET_SECONDS : MAX_QUARTER_SECONDS;
  if (periodSeconds > maxSecs) {
    warnings.push(`periodSeconds ${periodSeconds} exceeds max ${maxSecs} — clamp`);
    periodSeconds = maxSecs;
  }

  // Status validation
  const status = mapMatchStatus(fixture.matchStatus);

  // Player validation (warning only)
  const allPlayers = [
    ...(detail.playerStats?.home ?? []),
    ...(detail.playerStats?.away ?? []),
  ];
  const unknownPlayerIds: number[] = [];
  for (const p of allPlayers) {
    if (!dbPlayers.has(p.playerId)) {
      unknownPlayerIds.push(p.playerId);
    }
  }
  if (unknownPlayerIds.length > 0) {
    warnings.push(`Unknown player IDs: ${unknownPlayerIds.join(', ')}`);
  }

  // Score flow monotonicity check (warn only — CD corrections can cause brief dips)
  if (detail.scoreFlow && detail.scoreFlow.length > 1) {
    let prevTotal = detail.scoreFlow[0].homeScore + detail.scoreFlow[0].awayScore;
    for (let i = 1; i < detail.scoreFlow.length; i++) {
      const total = detail.scoreFlow[i].homeScore + detail.scoreFlow[i].awayScore;
      if (total < prevTotal) {
        warnings.push(`Non-monotonic score flow at index ${i}: total ${total} < prev ${prevTotal}`);
        scoreFlowValid = false;
        break;
      }
      prevTotal = total;
    }
  }

  if (!valid) {
    return { valid, scoreFlowValid, warnings, errors, validatedData: null };
  }

  // Build validated data
  const validatedData: ProcessedMatchState = {
    cdMatchId: fixture.matchId,
    homeScore: detail.matchInfo.homeScore,
    awayScore: detail.matchInfo.awayScore,
    status,
    currentQuarter: period,
    currentTime: String(periodSeconds),
    quarterScores: detail.periodScores?.map((ps) => ({
      quarter: ps.period,
      homeScore: ps.homeScore,
      awayScore: ps.awayScore,
    })),
    playerStats: allPlayers
      .filter((ps) => dbPlayers.has(ps.playerId))
      .map((ps) => ({
        championDataPlayerId: ps.playerId,
        ...pickStatFields(ps),
      })),
  };

  // Include score flow even if monotonicity check failed (CD corrections are common)
  if (detail.scoreFlow && homeTeam && awayTeam) {
    validatedData.scoreFlow = detail.scoreFlow.map((sf) => ({
      period: sf.period,
      periodSeconds: sf.periodSeconds,
      squadId: sf.squadId,
      scorepoints: sf.scorepoints,
      homeScore: sf.homeScore,
      awayScore: sf.awayScore,
      scoringTeamPrismaId:
        sf.squadId === detail.matchInfo.homeSquadId
          ? homeTeam.id
          : awayTeam.id,
    }));
  }

  return { valid, scoreFlowValid, warnings, errors, validatedData };
}

// ── Change Detection ──

export async function detectChanges(
  incoming: ProcessedMatchState,
): Promise<ChangeResult> {
  const match = await prisma.match.findUnique({
    where: { championDataMatchId: incoming.cdMatchId },
  });
  if (!match) {
    return {
      matchId: '',
      scoreChanged: false,
      statusChanged: false,
      timeChanged: false,
      newHomeScore: incoming.homeScore,
      newAwayScore: incoming.awayScore,
      newStatus: incoming.status,
      currentQuarter: incoming.currentQuarter,
      currentTime: incoming.currentTime,
    };
  }

  return {
    matchId: match.id,
    scoreChanged:
      match.homeScore !== incoming.homeScore ||
      match.awayScore !== incoming.awayScore,
    statusChanged: match.status !== incoming.status,
    timeChanged:
      match.currentQuarter !== incoming.currentQuarter ||
      match.currentTime !== incoming.currentTime,
    newHomeScore: incoming.homeScore,
    newAwayScore: incoming.awayScore,
    newStatus: incoming.status,
    currentQuarter: incoming.currentQuarter,
    currentTime: incoming.currentTime,
  };
}

// ── Apply Changes (write to live tables) ──

export async function applyChanges(
  changes: ChangeResult,
  incoming: ProcessedMatchState,
): Promise<Map<string, Array<{ playerId: string; name: string }>>> {
  if (!changes.matchId) return new Map();

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

  if (incoming.quarterScores) {
    for (const qs of incoming.quarterScores) {
      await prisma.matchQuarter.upsert({
        where: { matchId_quarter: { matchId: changes.matchId, quarter: qs.quarter } },
        update: { homeScore: qs.homeScore, awayScore: qs.awayScore },
        create: { matchId: changes.matchId, quarter: qs.quarter, homeScore: qs.homeScore, awayScore: qs.awayScore },
      });
    }
  }

  // Scorer attribution
  const scorersByTeam = new Map<string, Array<{ playerId: string; name: string }>>();

  if (incoming.playerStats && incoming.playerStats.length > 0) {
    const players = await prisma.player.findMany({
      where: { championDataPlayerId: { in: incoming.playerStats.map((ps) => ps.championDataPlayerId) } },
      select: { id: true, name: true, championDataPlayerId: true, teamId: true },
    });
    const playerMap = new Map(players.map((p) => [p.championDataPlayerId, p]));

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
          where: { playerId_matchId: { playerId: player.id, matchId: changes.matchId } },
          update: statsData,
          create: { playerId: player.id, matchId: changes.matchId, ...statsData },
        });
      });

    await prisma.$transaction(upserts);

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

  if (incoming.scoreFlow && incoming.scoreFlow.length > 0) {
    const existing = await prisma.scoreFlow.findMany({
      where: { matchId: changes.matchId },
      select: { period: true, periodSeconds: true },
    });
    const existingKeys = new Set(existing.map((sf) => `${sf.period}-${sf.periodSeconds}`));
    const scorerIdx = new Map<string, number>();

    for (const sf of incoming.scoreFlow) {
      const isNew = !existingKeys.has(`${sf.period}-${sf.periodSeconds}`);
      let scorerPlayerId: string | undefined;
      if (isNew) {
        const queue = scorersByTeam.get(sf.scoringTeamPrismaId);
        if (queue) {
          const idx = scorerIdx.get(sf.scoringTeamPrismaId) ?? 0;
          if (idx < queue.length) {
            scorerPlayerId = queue[idx].playerId;
            scorerIdx.set(sf.scoringTeamPrismaId, idx + 1);
          }
        }
      }

      await prisma.scoreFlow.upsert({
        where: { matchId_period_periodSeconds: { matchId: changes.matchId, period: sf.period, periodSeconds: sf.periodSeconds } },
        update: { homeScore: sf.homeScore, awayScore: sf.awayScore },
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

  return scorersByTeam;
}

// ── Write final stats helper (shared by applyChanges and finalizeCompletedMatches) ──

export async function writeFinalStats(
  matchId: string,
  detail: CDMatchStatsResponse,
): Promise<void> {
  const allPlayers = [
    ...(detail.playerStats?.home ?? []),
    ...(detail.playerStats?.away ?? []),
  ];

  // Quarter scores
  if (detail.periodScores) {
    for (const ps of detail.periodScores) {
      await prisma.matchQuarter.upsert({
        where: { matchId_quarter: { matchId, quarter: ps.period } },
        update: { homeScore: ps.homeScore, awayScore: ps.awayScore },
        create: { matchId, quarter: ps.period, homeScore: ps.homeScore, awayScore: ps.awayScore },
      });
    }
  }

  // Player stats
  if (allPlayers.length > 0) {
    const players = await prisma.player.findMany({
      where: { championDataPlayerId: { in: allPlayers.map((p) => p.playerId) } },
      select: { id: true, championDataPlayerId: true, teamId: true },
    });
    const playerMap = new Map(players.map((p) => [p.championDataPlayerId, p]));

    const upserts = allPlayers
      .filter((ps) => playerMap.has(ps.playerId))
      .map((ps) => {
        const player = playerMap.get(ps.playerId)!;
        const statsData = pickStatFields(ps);
        return prisma.playerMatchStats.upsert({
          where: { playerId_matchId: { playerId: player.id, matchId } },
          update: statsData,
          create: { playerId: player.id, matchId, ...statsData },
        });
      });

    await prisma.$transaction(upserts);
  }

  // Score flow
  if (detail.scoreFlow && detail.scoreFlow.length > 0) {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { homeTeam: { select: { championDataTeamId: true, id: true } }, awayTeam: { select: { championDataTeamId: true, id: true } } },
    });
    if (!match) return;

    const existing = await prisma.scoreFlow.findMany({
      where: { matchId },
      select: { period: true, periodSeconds: true },
    });
    const existingKeys = new Set(existing.map((sf) => `${sf.period}-${sf.periodSeconds}`));

    for (const sf of detail.scoreFlow) {
      const scoringTeamPrismaId =
        sf.squadId === match.homeTeam.championDataTeamId
          ? match.homeTeam.id
          : match.awayTeam.id;

      if (!existingKeys.has(`${sf.period}-${sf.periodSeconds}`)) {
        await prisma.scoreFlow.create({
          data: {
            matchId,
            period: sf.period,
            periodSeconds: sf.periodSeconds,
            scoringTeamId: scoringTeamPrismaId,
            homeScore: sf.homeScore,
            awayScore: sf.awayScore,
            scorePoints: sf.scorepoints,
            scorerPlayerId: null,
          },
        });
      } else {
        await prisma.scoreFlow.update({
          where: { matchId_period_periodSeconds: { matchId, period: sf.period, periodSeconds: sf.periodSeconds } },
          data: { homeScore: sf.homeScore, awayScore: sf.awayScore },
        });
      }
    }
  }
}

// ── Reconciliation (from match-sync.ts) ──

export async function reconcileCompletedMatches(
  fixtureMatches: CDFixtureMatch[],
): Promise<Array<{ matchId: string; homeScore: number; awayScore: number; finalQuarter: number }>> {
  const unresolvedMatches = await prisma.match.findMany({
    where: { status: { in: ['LIVE', 'SCHEDULED'] } },
    select: { id: true, status: true, championDataMatchId: true },
  });
  if (unresolvedMatches.length === 0) return [];

  const fixtureMap = new Map(fixtureMatches.map((fm) => [fm.matchId, fm]));
  const completed: Array<{ matchId: string; homeScore: number; awayScore: number; finalQuarter: number }> = [];

  for (const dbMatch of unresolvedMatches) {
    if (!dbMatch.championDataMatchId) continue;
    const fixture = fixtureMap.get(dbMatch.championDataMatchId);
    if (!fixture || fixture.matchStatus.toLowerCase() !== 'complete') continue;

    await prisma.match.update({
      where: { id: dbMatch.id },
      data: { status: 'COMPLETED', homeScore: fixture.homeSquadScore, awayScore: fixture.awaySquadScore },
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

// ── Stale match detection (from worker.ts) ──

export async function detectStaleCompletedMatches(): Promise<
  Array<{ matchId: string; homeScore: number; awayScore: number; finalQuarter: number }>
> {
  const liveMatches = await prisma.match.findMany({ where: { status: 'LIVE' } });
  const completed: Array<{ matchId: string; homeScore: number; awayScore: number; finalQuarter: number }> = [];
  const now = Date.now();

  for (const match of liveMatches) {
    const quarter = match.currentQuarter ?? 0;
    if (quarter < 4) continue;
    const elapsed = Number(match.currentTime);
    if (isNaN(elapsed)) continue;

    const quarterLength = quarter > 4 ? 300 : 900;
    const remaining = quarterLength - elapsed;
    const sinceUpdate = now - match.updatedAt.getTime();

    if (remaining < 120 && sinceUpdate >= 60_000) {
      console.log(`[Processing] Match ended (stale clock <2min remaining, no update for 60s): ${match.id}`);
      await prisma.match.update({ where: { id: match.id }, data: { status: 'COMPLETED' } });
      completed.push({ matchId: match.id, homeScore: match.homeScore, awayScore: match.awayScore, finalQuarter: quarter });
      continue;
    }

    if (elapsed >= quarterLength) {
      const matchAge = now - match.scheduledAt.getTime();
      if (matchAge >= 90 * 60 * 1000) {
        console.log(`[Processing] Stale LIVE match: ${match.id}`);
        await prisma.match.update({ where: { id: match.id }, data: { status: 'COMPLETED' } });
        completed.push({ matchId: match.id, homeScore: match.homeScore, awayScore: match.awayScore, finalQuarter: quarter });
      }
    }
  }

  return completed;
}

// ── Post-completion finalization ──

export async function finalizeCompletedMatches(
  fixtureMatches: CDFixtureMatch[],
  competitionId: number,
  newlyCompletedIds: string[],
): Promise<Array<{ matchId: string; homeScore: number; awayScore: number; finalQuarter: number }>> {
  if (newlyCompletedIds.length === 0) return [];

  const fixtureMap = new Map(fixtureMatches.map((fm) => [fm.matchId, fm]));
  const finalized: Array<{ matchId: string; homeScore: number; awayScore: number; finalQuarter: number }> = [];

  const matches = await prisma.match.findMany({
    where: { id: { in: newlyCompletedIds }, championDataMatchId: { not: null } },
    select: { id: true, championDataMatchId: true, homeScore: true, awayScore: true },
  });

  for (const match of matches) {
    const fixture = fixtureMap.get(match.championDataMatchId!);
    if (!fixture) continue;

    const fixtureHome = fixture.homeSquadScore;
    const fixtureAway = fixture.awaySquadScore;
    const scoresChanged = match.homeScore !== fixtureHome || match.awayScore !== fixtureAway;

    if (scoresChanged) {
      console.log(
        `[Processing] Finalizing scores for ${match.id}: ${match.homeScore}-${match.awayScore} → ${fixtureHome}-${fixtureAway}`,
      );
      await prisma.match.update({
        where: { id: match.id },
        data: { homeScore: fixtureHome, awayScore: fixtureAway },
      });
    }

    try {
      const detail = await fetchMatchStats(competitionId, match.championDataMatchId!);
      await writeFinalStats(match.id, detail);
    } catch (err) {
      console.error(`[Processing] Failed to fetch final stats for ${match.id}:`, err);
    }

    const finalQuarter = fixture.periodCompleted || fixture.period || 4;
    finalized.push({ matchId: match.id, homeScore: fixtureHome, awayScore: fixtureAway, finalQuarter });
  }

  return finalized;
}
