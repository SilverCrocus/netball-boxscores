import { prisma } from '@/lib/db';
import { fetchFixture, fetchMatchStats, mapMatchStatus } from '@/lib/champion-data';
import { detectChanges, applyChanges, reconcileCompletedMatches } from '@/lib/match-sync';
import {
  broadcastScoreUpdate,
  broadcastMatchStatus,
  broadcastStatsUpdate,
  broadcastScoreFlowAdd,
} from '@/lib/socket-server';

const POLL_SIM = 2_000; // 2 seconds in simulation mode
const POLL_LIVE = 30_000; // 30 seconds
const POLL_MATCH_DAY = 900_000; // 15 minutes
const POLL_OFF_SEASON = 21_600_000; // 6 hours

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

export function getPollingInterval(
  hasLiveMatch: boolean,
  isMatchDay: boolean
): number {
  if (process.env.SIMULATION_MODE === 'true') return POLL_SIM;
  if (hasLiveMatch) return POLL_LIVE;
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const matchCount = await prisma.match.count({
    where: {
      scheduledAt: { gte: today, lt: tomorrow },
    },
  });
  return matchCount > 0;
}

async function pollChampionData(): Promise<void> {
  try {
    const COMP_ID = 12949;

    const matches = await fetchFixture(COMP_ID);

    for (const matchData of matches) {
      if (matchData.matchStatus.toLowerCase() !== 'playing') continue;

      let matchDetail;
      try {
        matchDetail = await fetchMatchStats(COMP_ID, matchData.matchId);
      } catch {
        continue;
      }

      // Resolve team IDs for score flow
      const dbMatch = await prisma.match.findUnique({
        where: { championDataMatchId: matchData.matchId },
        include: { homeTeam: true, awayTeam: true },
      });

      const incoming = {
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

      const changes = await detectChanges(incoming);

      if (changes.matchId && (changes.scoreChanged || changes.statusChanged)) {
        await applyChanges(changes, incoming);

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

        // Broadcast player stats if available
        if (matchDetail.playerStats) {
          const allPlayerStats = [
            ...(matchDetail.playerStats.home ?? []),
            ...(matchDetail.playerStats.away ?? []),
          ];

          // Resolve CD player IDs to Prisma IDs for broadcast
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
            }));

          if (statsPayload.length > 0) {
            broadcastStatsUpdate(changes.matchId, {
              matchId: changes.matchId,
              playerStats: statsPayload,
            });
          }
        }

        // Broadcast new score flow entries
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
  } catch (error) {
    console.error('[Worker] Poll error:', error);
  }
}

async function scheduleNextPoll(): Promise<void> {
  if (!isRunning) return;

  const hasLive = await checkForLiveMatches();
  const isMatchDay = await checkIsMatchDay();
  const interval = getPollingInterval(hasLive, isMatchDay);

  console.log(
    `[Worker] Next poll in ${interval / 1000}s (live: ${hasLive}, matchDay: ${isMatchDay})`
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
