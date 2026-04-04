import { prisma } from '@/lib/db';
import { fetchFixture, fetchMatchStats, mapMatchStatus } from '@/lib/champion-data';
import { detectChanges, applyChanges, reconcileCompletedMatches } from '@/lib/match-sync';
import { recalculateStandings } from '@/lib/standings';
import {
  broadcastScoreUpdate,
  broadcastMatchStatus,
  broadcastStatsUpdate,
  broadcastScoreFlowAdd,
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

  if (matchDetail.scoreFlow && matchDetail.scoreFlow.length > 0 && dbMatch) {
    for (const sf of matchDetail.scoreFlow) {
      const scoringTeamId =
        sf.squadId === dbMatch.homeTeam.championDataTeamId
          ? dbMatch.homeTeamId
          : dbMatch.awayTeamId;

      broadcastScoreFlowAdd(changes.matchId, {
        matchId: changes.matchId,
        period: sf.period,
        periodSeconds: sf.periodSeconds,
        scoringTeamId,
        homeScore: sf.homeScore,
        awayScore: sf.awayScore,
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

      if (changes.matchId && hasChanges) {
        await applyChanges(changes, incoming);
        await broadcastChanges(changes, matchDetail, dbMatch);
      }
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

    if (completedMatches.length > 0) {
      console.log(`[Worker] ${completedMatches.length} match(es) completed — recalculating standings`);
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
