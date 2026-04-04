import { prisma } from '@/lib/db';
import { fetchFixture, fetchMatchStats, mapMatchStatus } from '@/lib/champion-data';
import { detectChanges, applyChanges, reconcileCompletedMatches } from '@/lib/match-sync';
import { recalculateStandings } from '@/lib/standings';
import {
  broadcastScoreUpdate,
  broadcastMatchStatus,
  broadcastStatsUpdate,
  broadcastScoreFlowAdd,
  broadcastStatEvent,
} from '@/lib/socket-server';
import { pickStatFields } from '@/lib/stat-utils';

const POLL_SIM = 2_000; // 2 seconds in simulation mode
const POLL_LIVE = 30_000; // 30 seconds
const POLL_PRE_MATCH = 60_000; // 1 minute — match starting within 30min
const POLL_MATCH_DAY = 900_000; // 15 minutes
const POLL_OFF_SEASON = 21_600_000; // 6 hours

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

export function getPollingInterval(
  hasLiveMatch: boolean,
  isMatchDay: boolean,
  hasPreMatch: boolean
): number {
  if (process.env.SIMULATION_MODE === 'true') return POLL_SIM;
  if (hasLiveMatch) return POLL_LIVE;
  if (hasPreMatch) return POLL_PRE_MATCH;
  if (isMatchDay) return POLL_MATCH_DAY;
  return POLL_OFF_SEASON;
}

async function checkForLiveMatches(): Promise<boolean> {
  const liveCount = await prisma.match.count({
    where: { status: 'LIVE' },
  });
  return liveCount > 0;
}

async function checkIsMatchDay(): Promise<boolean> {
  // Pin to AEST — Render servers run in UTC
  const aestNow = new Date(new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }));
  aestNow.setHours(0, 0, 0, 0);
  const aestTomorrow = new Date(aestNow);
  aestTomorrow.setDate(aestTomorrow.getDate() + 1);

  const matchCount = await prisma.match.count({
    where: {
      scheduledAt: { gte: aestNow, lt: aestTomorrow },
    },
  });
  return matchCount > 0;
}

async function checkPreMatch(): Promise<boolean> {
  const now = new Date();
  const thirtyMinsFromNow = new Date(now.getTime() + 30 * 60 * 1000);

  const matchCount = await prisma.match.count({
    where: {
      status: 'SCHEDULED',
      scheduledAt: { gte: now, lte: thirtyMinsFromNow },
    },
  });
  return matchCount > 0;
}

import type { CDFixtureMatch, CDMatchStatsResponse } from '@/types/champion-data';

type DbMatchWithTeams = NonNullable<Awaited<ReturnType<typeof prisma.match.findUnique<{
  where: { championDataMatchId: number };
  include: { homeTeam: true; awayTeam: true };
}>>>>;

/**
 * Build the incoming match state object from Champion Data responses,
 * ready for change detection and DB persistence.
 */
function buildIncomingMatchState(
  matchData: CDFixtureMatch,
  matchDetail: CDMatchStatsResponse,
  dbMatch: DbMatchWithTeams | null
) {
  return {
    matchId: matchData.matchId,
    homeScore: matchDetail.matchInfo?.homeScore ?? 0,
    awayScore: matchDetail.matchInfo?.awayScore ?? 0,
    status: mapMatchStatus(matchData.matchStatus),
    currentQuarter: matchDetail.matchInfo?.period ?? 0,
    currentTime: `${matchDetail.matchInfo?.periodSeconds ?? 0}`,
    quarterScores: matchDetail.periodScores?.map((ps) => ({
      quarter: ps.period,
      homeScore: ps.homeScore,
      awayScore: ps.awayScore,
    })),
    playerStats: matchDetail.playerStats
      ? [
          ...(matchDetail.playerStats.home ?? []),
          ...(matchDetail.playerStats.away ?? []),
        ].map((ps) => ({
          championDataPlayerId: ps.playerId,
          ...pickStatFields(ps),
        }))
      : undefined,
    scoreFlow: matchDetail.scoreFlow && dbMatch
      ? matchDetail.scoreFlow.map((sf) => ({
          period: sf.period,
          periodSeconds: sf.periodSeconds,
          squadId: sf.squadId,
          scorepoints: sf.scorepoints,
          homeScore: sf.homeScore,
          awayScore: sf.awayScore,
          scoringTeamPrismaId:
            sf.squadId === dbMatch.homeTeam.championDataTeamId
              ? dbMatch.homeTeamId
              : dbMatch.awayTeamId,
        }))
      : undefined,
  };
}

/**
 * Broadcast all relevant Socket.io events after changes have been
 * detected and persisted.
 */
async function broadcastChanges(
  changes: Awaited<ReturnType<typeof detectChanges>>,
  matchDetail: CDMatchStatsResponse,
  dbMatch: DbMatchWithTeams | null
): Promise<void> {
  if (!changes.matchId) return;

  if (changes.scoreChanged) {
    broadcastScoreUpdate(changes.matchId, {
      matchId: changes.matchId,
      homeScore: changes.newHomeScore,
      awayScore: changes.newAwayScore,
      currentQuarter: changes.currentQuarter,
      currentTime: changes.currentTime,
    });
  }

  if (changes.statusChanged) {
    broadcastMatchStatus(changes.matchId, {
      matchId: changes.matchId,
      status: changes.newStatus as 'LIVE' | 'COMPLETED',
      quarter: changes.currentQuarter,
      time: changes.currentTime,
    });
  }

  if (matchDetail.playerStats) {
    const allPlayerStats = [
      ...(matchDetail.playerStats.home ?? []),
      ...(matchDetail.playerStats.away ?? []),
    ];

    const players = await prisma.player.findMany({
      where: {
        championDataPlayerId: {
          in: allPlayerStats.map((ps) => ps.playerId),
        },
      },
      select: { id: true, championDataPlayerId: true },
    });
    const playerIdMap = new Map(
      players.map((p) => [p.championDataPlayerId, p.id]),
    );

    const statsPayload = allPlayerStats
      .filter((ps) => playerIdMap.has(ps.playerId))
      .map((ps) => ({
        playerId: playerIdMap.get(ps.playerId)!,
        currentPosition: ps.position ?? '',
        ...pickStatFields(ps),
      }));

    if (statsPayload.length > 0) {
      broadcastStatsUpdate(changes.matchId, {
        matchId: changes.matchId,
        playerStats: statsPayload,
      });
    }
  }

  // Broadcast score flow from DB so scorer attributions are included
  if (matchDetail.scoreFlow && matchDetail.scoreFlow.length > 0) {
    const dbScoreFlow = await prisma.scoreFlow.findMany({
      where: { matchId: changes.matchId },
      include: { scorerPlayer: { select: { id: true, name: true } } },
      orderBy: [{ period: 'asc' }, { periodSeconds: 'asc' }],
    });

    for (const sf of dbScoreFlow) {
      broadcastScoreFlowAdd(changes.matchId, {
        matchId: changes.matchId,
        period: sf.period,
        periodSeconds: sf.periodSeconds,
        scoringTeamId: sf.scoringTeamId,
        homeScore: sf.homeScore,
        awayScore: sf.awayScore,
        scorePoints: sf.scorePoints,
        scorerPlayerId: sf.scorerPlayer?.id,
        scorerName: sf.scorerPlayer?.name,
      });
    }
  }
}

/**
 * Detect LIVE matches that appear to have ended but CD never marked "complete".
 *
 * Two detection paths:
 * 1. **Fast** — Q4+ with <1 min remaining and no DB update for 30s.
 *    Catches matches that finish normally but CD is slow to report "complete".
 * 2. **Fallback** — Q4+ clock past quarter end and 90+ min since scheduledAt.
 *    Catches matches where CD stopped sending data entirely.
 */
async function detectStaleCompletedMatches(): Promise<
  Array<{ matchId: string; homeScore: number; awayScore: number; finalQuarter: number }>
> {
  const liveMatches = await prisma.match.findMany({
    where: { status: 'LIVE' },
  });

  const completed: Array<{ matchId: string; homeScore: number; awayScore: number; finalQuarter: number }> = [];
  const now = Date.now();

  for (const match of liveMatches) {
    const quarter = match.currentQuarter ?? 0;
    if (quarter < 4) continue;

    const elapsed = Number(match.currentTime);
    if (isNaN(elapsed)) continue;

    const quarterLength = quarter > 4 ? 300 : 900; // ET = 5min, regular = 15min
    const remaining = quarterLength - elapsed;
    const sinceUpdate = now - match.updatedAt.getTime();

    // Fast path: under 1 minute remaining in Q4+ and no update for 30s
    if (remaining < 60 && sinceUpdate >= 30_000) {
      console.log(`[Worker] Match ended (fast): ${match.id} (Q${quarter}, ${remaining}s remaining, ${Math.round(sinceUpdate / 1000)}s since update)`);

      await prisma.match.update({
        where: { id: match.id },
        data: { status: 'COMPLETED' },
      });

      completed.push({
        matchId: match.id,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        finalQuarter: quarter,
      });
      continue;
    }

    // Fallback: clock past quarter end and 90+ min since scheduled start
    if (elapsed >= quarterLength) {
      const matchAge = now - match.scheduledAt.getTime();
      if (matchAge >= 90 * 60 * 1000) {
        console.log(`[Worker] Stale LIVE match detected: ${match.id} (Q${quarter}, ${elapsed}s elapsed, match age: ${Math.round(matchAge / 60000)}min)`);

        await prisma.match.update({
          where: { id: match.id },
          data: { status: 'COMPLETED' },
        });

        completed.push({
          matchId: match.id,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          finalQuarter: quarter,
        });
      }
    }
  }

  return completed;
}

/**
 * Broadcast just player stats (including positions) without score/status/flow.
 * Used when positions change but no scoring activity occurred.
 */
async function broadcastPlayerStats(
  matchId: string,
  matchDetail: CDMatchStatsResponse,
): Promise<void> {
  if (!matchDetail.playerStats) return;

  const allPlayerStats = [
    ...(matchDetail.playerStats.home ?? []),
    ...(matchDetail.playerStats.away ?? []),
  ];

  const players = await prisma.player.findMany({
    where: {
      championDataPlayerId: { in: allPlayerStats.map((ps) => ps.playerId) },
    },
    select: { id: true, championDataPlayerId: true },
  });
  const playerIdMap = new Map(players.map((p) => [p.championDataPlayerId, p.id]));

  const statsPayload = allPlayerStats
    .filter((ps) => playerIdMap.has(ps.playerId))
    .map((ps) => ({
      playerId: playerIdMap.get(ps.playerId)!,
      currentPosition: ps.position ?? '',
      ...pickStatFields(ps),
    }));

  if (statsPayload.length > 0) {
    broadcastStatsUpdate(matchId, { matchId, playerStats: statsPayload });
  }
}

async function broadcastInterceptEvents(
  matchId: string,
  matchDetail: CDMatchStatsResponse,
  dbMatch: DbMatchWithTeams,
  oldInterceptMap: Map<string, number>,
  quarter: number,
  time: string,
): Promise<void> {
  const allPlayerStats = [
    ...(matchDetail.playerStats.home ?? []),
    ...(matchDetail.playerStats.away ?? []),
  ];

  const players = await prisma.player.findMany({
    where: {
      championDataPlayerId: { in: allPlayerStats.map((ps) => ps.playerId) },
    },
    select: { id: true, name: true, championDataPlayerId: true, teamId: true },
  });
  const playerMap = new Map(players.map((p) => [p.championDataPlayerId, p]));

  for (const ps of allPlayerStats) {
    const player = playerMap.get(ps.playerId);
    if (!player) continue;
    const oldIntercepts = oldInterceptMap.get(player.id) ?? 0;
    const newIntercepts = (ps.intercepts ?? 0) - oldIntercepts;
    if (newIntercepts <= 0) continue;

    const isHome = player.teamId === dbMatch.homeTeamId;
    const team = isHome ? dbMatch.homeTeam : dbMatch.awayTeam;

    for (let i = 0; i < newIntercepts; i++) {
      broadcastStatEvent(matchId, {
        matchId,
        type: 'intercept',
        playerId: player.id,
        playerName: player.name,
        teamId: team.id,
        teamName: team.name,
        teamAbbreviation: team.abbreviation,
        teamLogoUrl: team.logoUrl,
        isHomeTeam: isHome,
        quarter,
        time,
      });
    }
  }
}

async function pollChampionData(): Promise<void> {
  try {
    const COMP_ID = parseInt(process.env.SSN_COMPETITION_ID ?? '12949', 10);

    const matches = await fetchFixture(COMP_ID);

    for (const matchData of matches) {
      if (matchData.matchStatus.toLowerCase() !== 'playing') continue;

      let matchDetail;
      try {
        matchDetail = await fetchMatchStats(COMP_ID, matchData.matchId);
      } catch {
        continue;
      }

      const dbMatch = await prisma.match.findUnique({
        where: { championDataMatchId: matchData.matchId },
        include: { homeTeam: true, awayTeam: true },
      });

      const incoming = buildIncomingMatchState(matchData, matchDetail, dbMatch);
      const changes = await detectChanges(incoming);
      const hasChanges = changes.scoreChanged || changes.statusChanged || changes.timeChanged;

      // Snapshot old intercept counts before applying changes (for intercept feed events)
      let oldInterceptMap: Map<string, number> | undefined;
      if (changes.matchId && matchDetail.playerStats) {
        const oldStats = await prisma.playerMatchStats.findMany({
          where: { matchId: changes.matchId },
          select: { playerId: true, intercepts: true },
        });
        oldInterceptMap = new Map(oldStats.map((s) => [s.playerId, s.intercepts]));
      }

      if (changes.matchId && hasChanges) {
        await applyChanges(changes, incoming);
        await broadcastChanges(changes, matchDetail, dbMatch);
      } else if (changes.matchId && matchDetail.playerStats) {
        // Even without score/status/time changes, broadcast stats so position
        // swaps (substitutions) reach the client immediately
        await broadcastPlayerStats(changes.matchId, matchDetail);
      }

      // Broadcast intercept events for any new intercepts
      if (changes.matchId && oldInterceptMap && matchDetail.playerStats && dbMatch) {
        await broadcastInterceptEvents(
          changes.matchId,
          matchDetail,
          dbMatch,
          oldInterceptMap,
          changes.currentQuarter,
          changes.currentTime,
        );
      }
    }

    // Check for stale LIVE matches: if CD stopped sending updates but never
    // marked the match as "complete", detect based on Q4+ and clock at/past end
    const staleCompleted = await detectStaleCompletedMatches();
    for (const stale of staleCompleted) {
      broadcastMatchStatus(stale.matchId, {
        matchId: stale.matchId,
        status: 'COMPLETED',
        quarter: stale.finalQuarter,
        time: '0',
      });
      broadcastScoreUpdate(stale.matchId, {
        matchId: stale.matchId,
        homeScore: stale.homeScore,
        awayScore: stale.awayScore,
        currentQuarter: stale.finalQuarter,
        currentTime: '0',
      });
    }

    // Reconcile matches that Champion Data marked complete but DB still has as LIVE
    const completedMatches = await reconcileCompletedMatches(matches);
    for (const completed of completedMatches) {
      broadcastMatchStatus(completed.matchId, {
        matchId: completed.matchId,
        status: 'COMPLETED',
        quarter: completed.finalQuarter,
        time: '0',
      });
      broadcastScoreUpdate(completed.matchId, {
        matchId: completed.matchId,
        homeScore: completed.homeScore,
        awayScore: completed.awayScore,
        currentQuarter: completed.finalQuarter,
        currentTime: '0',
      });
    }

    if (completedMatches.length > 0 || staleCompleted.length > 0) {
      const totalCompleted = completedMatches.length + staleCompleted.length;
      console.log(`[Worker] ${totalCompleted} match(es) completed — recalculating standings`);
      try {
        await recalculateStandings();
      } catch (error) {
        console.error('[Worker] Standings recalculation failed:', error);
      }
    }
  } catch (error) {
    console.error('[Worker] Poll error:', error);
  }
}

async function scheduleNextPoll(): Promise<void> {
  if (!isRunning) return;

  const hasLive = await checkForLiveMatches();
  const hasPreMatch = !hasLive && await checkPreMatch();
  const isMatchDay = !hasLive && !hasPreMatch && await checkIsMatchDay();
  const interval = getPollingInterval(hasLive, isMatchDay, hasPreMatch);

  console.log(
    `[Worker] Next poll in ${interval / 1000}s (live: ${hasLive}, preMatch: ${hasPreMatch}, matchDay: ${isMatchDay})`
  );

  pollTimer = setTimeout(async () => {
    await pollChampionData();
    await scheduleNextPoll();
  }, interval);
}

export async function startWorker(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  console.log('[Worker] Starting background worker');
  // Poll immediately on startup, then schedule based on result
  await pollChampionData();
  scheduleNextPoll();
}

export function stopWorker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log('[Worker] Stopped');
}
