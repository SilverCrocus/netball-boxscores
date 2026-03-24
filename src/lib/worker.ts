import { prisma } from '@/lib/db';
import { detectChanges, applyChanges } from '@/lib/match-sync';
import {
  broadcastScoreUpdate,
  broadcastMatchStatus,
} from '@/lib/socket-server';
import type { CDFixtureMatch } from '@/types/champion-data';

const POLL_LIVE = 30_000; // 30 seconds
const POLL_MATCH_DAY = 900_000; // 15 minutes
const POLL_OFF_SEASON = 21_600_000; // 6 hours

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

export function getPollingInterval(
  hasLiveMatch: boolean,
  isMatchDay: boolean
): number {
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
    const COMP_ID = process.env.CHAMPION_DATA_COMP_ID;
    if (!COMP_ID) return;

    // Fetch live matches from Champion Data
    const res = await fetch(
      `https://mc.championdata.com/data/${COMP_ID}/fixture.json`
    );
    if (!res.ok) {
      console.error('[Worker] Champion Data fetch failed:', res.status);
      return;
    }

    const data = (await res.json()) as { fixture?: { match?: CDFixtureMatch[] } };

    const matches = data?.fixture?.match ?? [];
    for (const matchData of matches) {
      if (matchData.matchStatus.toLowerCase() !== 'playing') continue;

      // Fetch detailed match data
      const matchRes = await fetch(
        `https://mc.championdata.com/data/${COMP_ID}/${matchData.matchId}.json`
      );
      if (!matchRes.ok) continue;

      const matchDetail = (await matchRes.json()) as {
        matchStats?: { homeScore?: number; awayScore?: number; currentPeriod?: number; currentTime?: string };
      };

      const cdStatus = matchData.matchStatus.toLowerCase();
      const incoming = {
        matchId: matchData.matchId,
        homeScore: matchDetail.matchStats?.homeScore ?? 0,
        awayScore: matchDetail.matchStats?.awayScore ?? 0,
        status: cdStatus === 'complete' ? 'COMPLETED' : cdStatus === 'playing' ? 'LIVE' : 'SCHEDULED',
        currentQuarter: matchDetail.matchStats?.currentPeriod ?? 0,
        currentTime: matchDetail.matchStats?.currentTime ?? '',
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
      }
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

export function startWorker(): void {
  if (isRunning) return;
  isRunning = true;
  console.log('[Worker] Starting background worker');
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
