import { prisma } from '@/lib/db';
import { getLiveState } from '@/lib/live-state';
import { ingestFromChampionData, type IngestedData } from '@/lib/ingestion';
import {
  validateMatchData,
  syncFixtureMatches,
  detectChanges,
  applyChanges,
  reconcileCompletedMatches,
  reconcileStaleCompletedScores,
  detectStaleCompletedMatches,
  finalizeCompletedMatches,
} from '@/lib/processing';
import {
  broadcastMatchChanges,
  broadcastPlayerStats,
  persistAndBroadcastStatEvents,
  broadcastCompletion,
} from '@/lib/broadcasting';
import { recalculateStandings } from '@/lib/standings';
import { recordPoll, setCurrentInterval } from '@/lib/worker-health';
import { hasResolvedLegacyMatch } from '@/lib/edition-match';

// ── Polling intervals ──

const POLL_SIM = 2_000;
const POLL_LIVE = 10_000;
const POLL_PRE_MATCH = 60_000;
const POLL_MATCH_DAY = 120_000;
const POLL_OFF_SEASON = 3_600_000;

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

export function getPollingInterval(
  hasLive: boolean,
  isMatchDay: boolean,
  hasPreMatch: boolean,
): number {
  if (process.env.SIMULATION_MODE === 'true') return POLL_SIM;
  if (hasLive) return POLL_LIVE;
  if (hasPreMatch) return POLL_PRE_MATCH;
  if (isMatchDay) return POLL_MATCH_DAY;
  return POLL_OFF_SEASON;
}

// ── Main poll cycle ──

export async function pollChampionData(): Promise<void> {
  try {
    const COMP_ID = parseInt(process.env.SSN_COMPETITION_ID ?? '12949', 10);
    const FINALS_COMP_ID = parseInt(process.env.SSN_FINALS_COMPETITION_ID ?? '12950', 10);
    const competitionIds = process.env.SIMULATION_MODE === 'true'
      ? [COMP_ID]
      : [...new Set([COMP_ID, FINALS_COMP_ID])];

    // Phase 1: Ingest
    const ingestedSources: IngestedData[] = [];
    let sourceFetchErrors = 0;
    for (const competitionId of competitionIds) {
      try {
        const ingested = await ingestFromChampionData(competitionId);
        await syncFixtureMatches(ingested.fixture, COMP_ID, competitionId);
        ingestedSources.push(ingested);
      } catch (error) {
        sourceFetchErrors++;
        console.error(`[Worker] Competition ${competitionId} ingestion failed:`, error);
      }
    }

    const fixture = ingestedSources.flatMap((source) => source.fixture);
    const matchDetails = new Map(
      ingestedSources.flatMap((source) => [...source.matchDetails]),
    );
    const matchPollLogIds = new Map(
      ingestedSources.flatMap((source) => [...source.matchPollLogIds]),
    );
    const detailFetchErrors = ingestedSources.reduce(
      (sum, source) => sum + source.detailFetchErrors,
      0,
    );

    if (fixture.length === 0 && matchDetails.size === 0) {
      if (sourceFetchErrors === competitionIds.length) {
        recordPoll('error', 0);
        return;
      }
      recordPoll('empty', 0);
      return;
    }

    // Load DB lookups for validation
    const dbTeamsRaw = await prisma.team.findMany({
      select: { id: true, name: true, championDataTeamId: true },
    });
    const dbTeams = new Map(
      dbTeamsRaw
        .filter((t) => t.championDataTeamId !== null)
        .map((t) => [t.championDataTeamId!, { id: t.id, name: t.name }]),
    );
    const dbPlayersRaw = await prisma.player.findMany({
      select: { id: true, name: true, championDataPlayerId: true, teamId: true },
    });
    const dbPlayers = new Map(
      dbPlayersRaw
        .filter((p) => p.championDataPlayerId !== null)
        .map((p) => [p.championDataPlayerId!, { id: p.id, name: p.name, teamId: p.teamId }]),
    );

    let matchesProcessed = 0;

    // Phase 2 + 3: Validate, Process, Broadcast per match
    const fixtureByMatchId = new Map(fixture.map((match) => [match.matchId, match]));
    for (const [cdMatchId, matchDetail] of matchDetails) {
      const fixtureMatch = fixtureByMatchId.get(cdMatchId);
      if (!fixtureMatch) continue;

      const validation = validateMatchData(fixtureMatch, matchDetail, dbTeams, dbPlayers);

      // Update PollLog status
      const pollLogId = matchPollLogIds.get(cdMatchId);
      if (pollLogId && !validation.valid) {
        await prisma.pollLog.update({
          where: { id: pollLogId },
          data: { status: 'validation_error', errorMessage: validation.errors.join('; ') },
        });
        continue;
      }

      if (!validation.validatedData) continue;

      const startMs = Date.now();
      const changes = await detectChanges(validation.validatedData);
      const hasChanges = changes.scoreChanged || changes.statusChanged || changes.timeChanged;

      // Snapshot stat event counts before applying
      let oldStatMap: Map<string, { intercept: number; deflection: number; rebound: number; turnover: number }> | undefined;
      if (changes.matchId && matchDetail.playerStats) {
        const oldStats = await prisma.playerMatchStats.findMany({
          where: { matchId: changes.matchId },
          select: { playerId: true, intercepts: true, deflections: true, rebounds: true, turnovers: true },
        });
        oldStatMap = new Map(oldStats.map((s) => [s.playerId, {
          intercept: s.intercepts,
          deflection: s.deflections,
          rebound: s.rebounds,
          turnover: s.turnovers,
        }]));
      }

      const dbMatch = changes.matchId
        ? await prisma.match.findUnique({
            where: { id: changes.matchId },
            include: { homeTeam: true, awayTeam: true },
          })
        : null;

      if (changes.matchId) {
        await applyChanges(changes, validation.validatedData);
        if (hasChanges) {
          await broadcastMatchChanges(changes, matchDetail, dbMatch);
        } else if (matchDetail.playerStats) {
          await broadcastPlayerStats(changes.matchId, matchDetail);
        }
      }

      if (
        changes.matchId
        && oldStatMap
        && matchDetail.playerStats
        && dbMatch
        && hasResolvedLegacyMatch(dbMatch)
      ) {
        const periodSecs = parseInt(changes.currentTime, 10) || 0;
        await persistAndBroadcastStatEvents(
          changes.matchId, matchDetail, dbMatch, oldStatMap,
          changes.currentQuarter, periodSecs,
        );
      }

      // Update PollLog to processed
      if (pollLogId) {
        await prisma.pollLog.update({
          where: { id: pollLogId },
          data: { status: 'processed', processingMs: Date.now() - startMs },
        });
      }

      matchesProcessed++;
    }

    // Phase: Completion detection (reconcile first — uses canonical fixture scores)
    const reconciled = await reconcileCompletedMatches(fixture);
    const staleCompleted = await detectStaleCompletedMatches();

    // Phase: Finalization (re-fetch canonical scores + final stats for all newly completed)
    const allNewlyCompleted = [
      ...reconciled.map((c) => c.matchId),
      ...staleCompleted.map((c) => c.matchId),
    ];
    const finalized = await finalizeCompletedMatches(fixture, COMP_ID, allNewlyCompleted);

    // Phase: Drift correction — re-sync already-COMPLETED matches whose stored
    // score lags CD's canonical final (e.g. a closing super shot). Excludes the
    // matches just completed this poll (already finalized above).
    const staleScores = (await reconcileStaleCompletedScores(fixture)).filter(
      (s) => !allNewlyCompleted.includes(s.matchId),
    );

    // Phase: Broadcast (prefer finalized scores over provisional ones)
    const finalizedMap = new Map(finalized.map((f) => [f.matchId, f]));
    for (const completed of [...reconciled, ...staleCompleted]) {
      const final = finalizedMap.get(completed.matchId) ?? completed;
      broadcastCompletion(final.matchId, final.homeScore, final.awayScore, final.finalQuarter);
    }
    for (const corrected of staleScores) {
      broadcastCompletion(corrected.matchId, corrected.homeScore, corrected.awayScore, 4);
    }

    // Phase: Standings — recalc when any match completed or a stale score was corrected
    if (reconciled.length > 0 || staleCompleted.length > 0 || staleScores.length > 0) {
      const reason = staleScores.length > 0 && reconciled.length + staleCompleted.length === 0
        ? `${staleScores.length} stale score(s) corrected`
        : `${reconciled.length + staleCompleted.length} match(es) completed`;
      console.log(`[Worker] ${reason} — recalculating standings`);
      try {
        await recalculateStandings();
      } catch (error) {
        console.error('[Worker] Standings recalculation failed:', error);
      }
    }

    recordPoll(
      detailFetchErrors > 0 || sourceFetchErrors > 0 ? 'partial' : 'success',
      matchesProcessed,
    );
  } catch (error) {
    console.error('[Worker] Poll error:', error);
    recordPoll('error', 0);
  }
}

// ── Scheduling ──

async function scheduleNextPoll(): Promise<void> {
  if (!isRunning) return;

  let interval = POLL_OFF_SEASON;
  try {
    const state = await getLiveState();
    const hasLive = state.liveMatchIds.length > 0;
    const hasPreMatch = state.imminentMatchIds.length > 0;
    interval = getPollingInterval(hasLive, state.isMatchDay, hasPreMatch);

    console.log(
      `[Worker] Next poll in ${interval / 1000}s (live: ${hasLive}, preMatch: ${hasPreMatch}, matchDay: ${state.isMatchDay})`,
    );
  } catch (error) {
    console.error('[Worker] Failed to check live state, using fallback interval:', error);
  }

  setCurrentInterval(interval);

  pollTimer = setTimeout(async () => {
    await pollChampionData();
    await scheduleNextPoll();
  }, interval);
}

export async function startWorker(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  console.log('[Worker] Starting background worker');
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
