import { prisma } from '@/lib/db';
import { getLiveState } from '@/lib/live-state';
import { ingestFromChampionData, type IngestedData } from '@/lib/ingestion';
import {
  validateMatchData,
  syncFixtureMatches,
  applyChanges,
  reconcileCompletedMatches,
  reconcileStaleCompletedScores,
  detectStaleCompletedMatches,
  finalizeCompletedMatches,
} from '@/lib/processing';
import type { ChangeResult, ProcessedMatchState } from '@/lib/processing';
import {
  broadcastMatchChanges,
  broadcastPlayerStats,
  broadcastPersistedStatEvents,
  persistStatEvents,
  broadcastCompletion,
  broadcastScoreFlowDelta,
} from '@/lib/broadcasting';
import {
  acquireStandingsSourceLock,
  rebuildStandingsInTransaction,
} from '@/lib/standings';
import { beginPoll, recordPoll, setCurrentInterval } from '@/lib/worker-health';
import { hasResolvedLegacyMatch } from '@/lib/edition-match';
import { resolvePublicMatchAccess } from '@/lib/public-match';
import { runSerializableTransaction } from '@/lib/serializable-transaction';
import { safeErrorMessage } from '@/lib/safe-logging';
import { syncOfficialGlasgowResults } from '@/lib/glasgow/official-feed-sync';
import { isOfficialGlasgowFeedEnabled } from '@/lib/glasgow/official-feed';

// ── Polling intervals ──

const POLL_SIM = 2_000;
const POLL_LIVE = 30_000;
const POLL_PRE_MATCH = 60_000;
const POLL_MATCH_DAY = 120_000;
const POLL_OFF_SEASON = 3_600_000;

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;
const matchProcessingTails = new Map<string, Promise<void>>();

/**
 * Prevent two polls in this process from deriving events from the same match
 * snapshot concurrently. Database-level serializable retries cover overlap
 * with workers in other processes.
 */
export async function withMatchProcessingLock<T>(
  matchKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = matchProcessingTails.get(matchKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  matchProcessingTails.set(matchKey, tail);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (matchProcessingTails.get(matchKey) === tail) {
      matchProcessingTails.delete(matchKey);
    }
  }
}

export function deriveChangesFromSnapshot(
  match: {
    id: string;
    homeScore: number;
    awayScore: number;
    status: ChangeResult['newStatus'];
    currentQuarter: number | null;
    currentTime: string | null;
  },
  incoming: ProcessedMatchState,
): ChangeResult {
  return {
    matchId: match.id,
    scoreChanged: match.homeScore !== incoming.homeScore
      || match.awayScore !== incoming.awayScore,
    statusChanged: match.status !== incoming.status,
    timeChanged: match.currentQuarter !== incoming.currentQuarter
      || match.currentTime !== incoming.currentTime,
    newHomeScore: incoming.homeScore,
    newAwayScore: incoming.awayScore,
    newStatus: incoming.status,
    currentQuarter: incoming.currentQuarter,
    currentTime: incoming.currentTime,
  };
}

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

/**
 * Reject a fixture response whose request began before a revision already
 * committed for the same match. Detail observations from the rejected
 * fixture are discarded too: without a matching current fixture snapshot they
 * cannot be safely validated or finalized.
 */
async function filterSupersededFixtureObservation(
  ingested: IngestedData,
): Promise<IngestedData> {
  if (ingested.fixture.length === 0) return ingested;

  const championDataMatchIds = ingested.fixture.map((match) => match.matchId);
  const current = await prisma.match.findMany({
    where: { championDataMatchId: { in: championDataMatchIds } },
    select: {
      championDataMatchId: true,
      sourceRetrievedAt: true,
      sourceUpdatedAt: true,
    },
  });
  const supersededIds = new Set(
    current.flatMap((match) => (
      match.championDataMatchId !== null
      && (
        (
          match.sourceRetrievedAt !== null
          && match.sourceRetrievedAt >= ingested.fixtureObservationAt
        )
        || (
          match.sourceUpdatedAt !== null
          && match.sourceUpdatedAt >= ingested.fixtureObservationAt
        )
      )
        ? [match.championDataMatchId]
        : []
    )),
  );
  if (supersededIds.size === 0) return ingested;

  return {
    ...ingested,
    fixture: ingested.fixture.filter((match) => !supersededIds.has(match.matchId)),
    matchDetails: new Map(
      [...ingested.matchDetails].filter(([matchId]) => !supersededIds.has(matchId)),
    ),
    matchPollLogIds: new Map(
      [...ingested.matchPollLogIds].filter(([matchId]) => !supersededIds.has(matchId)),
    ),
  };
}

// ── Main poll cycle ──

export type WorkerPollStatus = 'success' | 'empty' | 'partial' | 'error';

export interface WorkerPollOutcome {
  status: WorkerPollStatus;
  matchesProcessed: number;
}

interface PollChampionDataOptions {
  recordHealth?: boolean;
}

function completePoll(
  outcome: WorkerPollOutcome,
  recordHealth: boolean,
): WorkerPollOutcome {
  if (recordHealth) {
    recordPoll(outcome.status, outcome.matchesProcessed);
  }
  return outcome;
}

export async function pollChampionData(
  options: PollChampionDataOptions = {},
): Promise<WorkerPollOutcome> {
  const shouldRecordHealth = options.recordHealth ?? true;
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
        const currentObservation = await filterSupersededFixtureObservation(ingested);
        await syncFixtureMatches(
          currentObservation.fixture,
          COMP_ID,
          competitionId,
          currentObservation.fixtureObservationAt,
        );
        ingestedSources.push(currentObservation);
      } catch (error) {
        sourceFetchErrors++;
        console.error(
          `[Worker] Competition ${competitionId} ingestion failed:`,
          safeErrorMessage(error),
        );
      }
    }

    const fixture = ingestedSources.flatMap((source) => source.fixture);
    const matchDetails = new Map(
      ingestedSources.flatMap((source) => [...source.matchDetails]),
    );
    const matchPollLogIds = new Map(
      ingestedSources.flatMap((source) => [...source.matchPollLogIds]),
    );
    const fixtureObservationByMatchId = new Map(
      ingestedSources.flatMap((source) => (
        source.fixture.map((match) => [match.matchId, source.fixtureObservationAt] as const)
      )),
    );
    const detailFetchErrors = ingestedSources.reduce(
      (sum, source) => sum + source.detailFetchErrors,
      0,
    );

    if (fixture.length === 0 && matchDetails.size === 0) {
      if (sourceFetchErrors === competitionIds.length) {
        return completePoll(
          { status: 'error', matchesProcessed: 0 },
          shouldRecordHealth,
        );
      }
      return completePoll(
        { status: 'empty', matchesProcessed: 0 },
        shouldRecordHealth,
      );
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
    const supersededChampionDataMatchIds = new Set<number>();

    // Phase 2 + 3: Validate, Process, Broadcast per match
    const fixtureByMatchId = new Map(fixture.map((match) => [match.matchId, match]));
    for (const [cdMatchId, matchDetail] of matchDetails) {
      const fixtureMatch = fixtureByMatchId.get(cdMatchId);
      if (!fixtureMatch) continue;

      const validation = validateMatchData(fixtureMatch, matchDetail, dbTeams, dbPlayers);

      // Update PollLog status
      const pollLogId = matchPollLogIds.get(cdMatchId);
      if (!pollLogId) {
        supersededChampionDataMatchIds.add(cdMatchId);
        console.error(`[Worker] Match ${cdMatchId} has no persisted source observation — skipping`);
        continue;
      }
      if (!validation.valid) {
        supersededChampionDataMatchIds.add(cdMatchId);
        await prisma.pollLog.update({
          where: { id: pollLogId },
          data: { status: 'validation_error', errorMessage: validation.errors.join('; ') },
        });
        continue;
      }

      const validatedData = validation.validatedData;
      if (!validatedData) continue;
      const acceptedFixtureObservationAt = fixtureObservationByMatchId.get(cdMatchId);
      if (!acceptedFixtureObservationAt) {
        supersededChampionDataMatchIds.add(cdMatchId);
        continue;
      }

      await withMatchProcessingLock(`champion-data:${cdMatchId}`, async () => {
        const startMs = Date.now();
        const transactionResult = await runSerializableTransaction(async (tx) => {
          const currentMatch = await tx.match.findUnique({
            where: { championDataMatchId: cdMatchId },
            include: { homeTeam: true, awayTeam: true },
          });
          if (!currentMatch) return { applied: false as const, reason: 'missing' as const };

          const observation = await tx.pollLog.findUnique({
            where: { id: pollLogId },
            select: { polledAt: true },
          });
          if (!observation) {
            throw new Error(`Source observation ${pollLogId} disappeared before persistence`);
          }
          const observationAlreadyApplied = currentMatch.sourceUpdatedAt !== null
            && currentMatch.sourceUpdatedAt >= observation.polledAt;
          const fixtureRevisionStillAccepted = currentMatch.sourceRetrievedAt?.getTime()
            === acceptedFixtureObservationAt.getTime();
          const protectedFinalReopened = currentMatch.status === 'COMPLETED'
            && ['OFFICIAL_FINAL', 'CORRECTED'].includes(currentMatch.resultQuality)
            && validatedData.status !== 'COMPLETED';
          if (
            observationAlreadyApplied
            || !fixtureRevisionStillAccepted
            || protectedFinalReopened
          ) {
            return { applied: false as const, reason: 'superseded' as const };
          }

          // A provider completion is finalized only after a fresh detail fetch
          // agrees with the fixture lifecycle, identity, and final score. The
          // live-detail path must never publish a partially reconciled final.
          if (validatedData.status === 'COMPLETED') {
            return { applied: false as const, reason: 'finalization' as const };
          }

          const changes = deriveChangesFromSnapshot(currentMatch, validatedData);
          const oldStats = matchDetail.playerStats
            ? await tx.playerMatchStats.findMany({
                where: { matchId: currentMatch.id },
                select: {
                  playerId: true,
                  intercepts: true,
                  deflections: true,
                  rebounds: true,
                  turnovers: true,
                },
              })
            : [];
          const oldStatMap = new Map(oldStats.map((stat) => [stat.playerId, {
            intercept: stat.intercepts,
            deflection: stat.deflections,
            rebound: stat.rebounds,
            turnover: stat.turnovers,
          }]));
          const standingsMutation = (
            currentMatch.status === 'COMPLETED'
            || changes.newStatus === 'COMPLETED'
          ) && (
            changes.scoreChanged
            || changes.statusChanged
            || (
              changes.newStatus === 'COMPLETED'
              && !['OFFICIAL_FINAL', 'CORRECTED'].includes(currentMatch.resultQuality)
            )
          );
          if (standingsMutation) {
            await acquireStandingsSourceLock(tx, currentMatch.competitionId);
          }

          let events: Awaited<ReturnType<typeof persistStatEvents>> = [];
          if (matchDetail.playerStats && hasResolvedLegacyMatch(currentMatch)) {
            const periodSecs = Number.parseInt(changes.currentTime, 10) || 0;
            events = await persistStatEvents(
              currentMatch.id,
              matchDetail,
              currentMatch,
              oldStatMap,
              changes.currentQuarter,
              periodSecs,
              tx,
            );
          }

          await applyChanges(changes, validatedData, tx);
          const revisionUpdate = await tx.match.updateMany({
            where: {
              id: currentMatch.id,
              sourceRetrievedAt: acceptedFixtureObservationAt,
              OR: [
                { sourceUpdatedAt: null },
                { sourceUpdatedAt: { lt: observation.polledAt } },
              ],
            },
            data: { sourceUpdatedAt: observation.polledAt },
          });
          if (revisionUpdate.count !== 1) {
            throw new Error(`Source observation ${pollLogId} lost its revision compare-and-set`);
          }
          if (standingsMutation) {
            await rebuildStandingsInTransaction(tx, currentMatch.competitionId);
          }
          return {
            applied: true as const,
            events,
            match: currentMatch,
            changes,
            revision: observation.polledAt,
          };
        });
        if (!transactionResult.applied) {
          if (transactionResult.reason === 'finalization') {
            await prisma.pollLog.update({
              where: { id: pollLogId },
              data: { status: 'processed', processingMs: Date.now() - startMs },
            });
            matchesProcessed++;
            return;
          }
          supersededChampionDataMatchIds.add(cdMatchId);
          await prisma.pollLog.update({
            where: { id: pollLogId },
            data: { status: 'superseded', processingMs: Date.now() - startMs },
          });
          return;
        }

        const { changes, events, match: dbMatch, revision } = transactionResult;
        const hasChanges = changes.scoreChanged || changes.statusChanged || changes.timeChanged;
        const publicAccess = await resolvePublicMatchAccess(changes.matchId).catch(() => null);
        if (hasChanges) {
          await broadcastMatchChanges(
            changes,
            matchDetail,
            dbMatch,
            publicAccess,
            revision,
          );
        } else if (matchDetail.playerStats) {
          await broadcastPlayerStats(
            changes.matchId,
            matchDetail,
            publicAccess,
            revision,
          );
        }
        // Score-flow is a replaceable canonical collection, so every accepted
        // observation offers a full snapshot. A later revision suppresses an
        // older snapshot at the final emit boundary.
        await broadcastScoreFlowDelta(
          changes.matchId,
          publicAccess,
          revision,
        );
        await broadcastPersistedStatEvents(changes.matchId, events, revision);

        // Update PollLog to processed only after the transaction and broadcasts succeed.
        await prisma.pollLog.update({
          where: { id: pollLogId },
          data: { status: 'processed', processingMs: Date.now() - startMs },
        });

        matchesProcessed++;
      });
    }

    // A rejected detail observation and its fixture came from the same poll.
    // Do not let that fixture bypass the durable observation gate through a
    // later finalization path.
    const currentFixture = fixture.filter(
      (match) => !supersededChampionDataMatchIds.has(match.matchId),
    );

    // Phase: completion detection. Fixture-only completion stores a durable
    // PROVISIONAL marker, never a score without its matching detail revision.
    const reconciled = await reconcileCompletedMatches(
      currentFixture,
      fixtureObservationByMatchId,
    );
    const staleCompleted = await detectStaleCompletedMatches();
    const pendingCorrections = await reconcileStaleCompletedScores(
      currentFixture,
      fixtureObservationByMatchId,
    );

    // A failed final-detail fetch remains durable through its non-final quality
    // and is retried on every later poll, even when it was not newly completed
    // in this process.
    const durablePending = await prisma.match.findMany({
      where: {
        status: 'COMPLETED',
        resultQuality: { in: ['UNKNOWN', 'PROVISIONAL', 'UNOFFICIAL_FINAL'] },
        championDataMatchId: { not: null },
      },
      select: { id: true },
    });

    // Failed official corrections are retryable source intent in their own
    // right. Bound the recovery scan and do not require the fixture score to
    // differ again before scheduling the next canonical detail attempt.
    const unresolvedCorrectionLogs = await prisma.pollLog.findMany({
      where: {
        endpoint: 'final-detail-correction',
        status: { in: ['pending', 'fetch_error', 'revision_mismatch'] },
        cdMatchId: { not: null },
      },
      select: { cdMatchId: true },
      orderBy: { polledAt: 'asc' },
      distinct: ['cdMatchId'],
      take: 100,
    });
    const currentFixtureIds = new Set(currentFixture.map((match) => match.matchId));
    const retryChampionDataMatchIds = unresolvedCorrectionLogs.flatMap((log) => (
      log.cdMatchId !== null && currentFixtureIds.has(log.cdMatchId)
        ? [log.cdMatchId]
        : []
    ));
    const durableCorrections = retryChampionDataMatchIds.length > 0
      ? await prisma.match.findMany({
          where: {
            status: 'COMPLETED',
            championDataMatchId: { in: retryChampionDataMatchIds },
          },
          select: { id: true },
        })
      : [];

    // Phase: finalization atomically applies score, quarters, player/team stats,
    // score-flow, quality, source revision, and affected standings.
    const finalizationIds = [...new Set([
      ...reconciled.map((c) => c.matchId),
      ...staleCompleted.map((c) => c.matchId),
      ...pendingCorrections.map((c) => c.matchId),
      ...durablePending.map((match) => match.id),
      ...durableCorrections.map((match) => match.id),
    ])];
    const correctionRetryIds = [...new Set([
      ...pendingCorrections.filter((candidate) => candidate.wasCorrection).map((candidate) => (
        candidate.matchId
      )),
      ...durableCorrections.map((match) => match.id),
    ])];
    const finalization = await finalizeCompletedMatches(
      currentFixture,
      COMP_ID,
      finalizationIds,
      correctionRetryIds,
      fixtureObservationByMatchId,
    );

    // Broadcast only a committed canonical revision. Failed/pending
    // finalizations remain silent and retry durably.
    const finalizedMap = new Map(finalization.matches.map((match) => [match.matchId, match]));
    const broadcastedCompletions = new Set<string>();
    for (const completed of [...reconciled, ...staleCompleted]) {
      if (broadcastedCompletions.has(completed.matchId)) continue;
      const final = finalizedMap.get(completed.matchId);
      if (!final) {
        console.warn(
          `[Worker] Completion ${completed.matchId} has no accepted persisted revision — broadcast skipped`,
        );
        continue;
      }
      await broadcastCompletion(
        final.matchId,
        final.homeScore,
        final.awayScore,
        final.finalQuarter,
        final.sourceUpdatedAt,
      );
      broadcastedCompletions.add(final.matchId);
    }
    for (const correctionMatchId of correctionRetryIds) {
      if (broadcastedCompletions.has(correctionMatchId)) continue;
      const final = finalizedMap.get(correctionMatchId);
      // Missing results are failed retries; a finalized row with no standings
      // change is a stale/superseded retry. Neither may emit a replacement.
      if (!final || !final.standingsChanged) continue;
      await broadcastCompletion(
        final.matchId,
        final.homeScore,
        final.awayScore,
        final.finalQuarter,
        final.sourceUpdatedAt,
      );
      broadcastedCompletions.add(final.matchId);
    }

    const status: WorkerPollStatus = detailFetchErrors > 0
      || sourceFetchErrors > 0
      || finalization.failedMatchIds.length > 0
        ? 'partial'
        : 'success';
    return completePoll(
      { status, matchesProcessed },
      shouldRecordHealth,
    );
  } catch (error) {
    console.error('[Worker] Poll error:', safeErrorMessage(error));
    return completePoll(
      { status: 'error', matchesProcessed: 0 },
      shouldRecordHealth,
    );
  }
}

function aggregatePollOutcomes(
  outcomes: WorkerPollOutcome[],
): WorkerPollOutcome {
  const matchesProcessed = outcomes.reduce(
    (total, outcome) => total + outcome.matchesProcessed,
    0,
  );
  let status: WorkerPollStatus = 'empty';
  if (outcomes.some((outcome) => outcome.status === 'error')) {
    status = 'error';
  } else if (outcomes.some((outcome) => outcome.status === 'partial')) {
    status = 'partial';
  } else if (outcomes.some((outcome) => outcome.status === 'success')) {
    status = 'success';
  }
  return { status, matchesProcessed };
}

export async function pollAllSources(): Promise<WorkerPollOutcome> {
  beginPoll();
  const outcomes: WorkerPollOutcome[] = [
    await pollChampionData({ recordHealth: false }),
  ];

  if (isOfficialGlasgowFeedEnabled()) {
    try {
      const glasgow = await syncOfficialGlasgowResults();
      if (
        (glasgow.status === 'partial' || glasgow.status === 'error')
        && glasgow.issues.length > 0
      ) {
        console.error(
          `[Worker] Glasgow official feed ${glasgow.status}:`,
          glasgow.issues.map((issue) => safeErrorMessage(issue)).join('; '),
        );
      }
      outcomes.push({
        status: glasgow.status,
        matchesProcessed: glasgow.matchesProcessed,
      });
    } catch (error) {
      console.error(
        '[Worker] Glasgow official feed sync failed:',
        safeErrorMessage(error),
      );
      outcomes.push({ status: 'error', matchesProcessed: 0 });
    }
  }

  const outcome = aggregatePollOutcomes(outcomes);
  recordPoll(outcome.status, outcome.matchesProcessed);
  return outcome;
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
    console.error(
      '[Worker] Failed to check live state, using fallback interval:',
      safeErrorMessage(error),
    );
  }

  setCurrentInterval(interval);

  pollTimer = setTimeout(async () => {
    await pollAllSources();
    await scheduleNextPoll();
  }, interval);
}

export async function startWorker(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  console.log('[Worker] Starting background worker');
  await pollAllSources();
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
