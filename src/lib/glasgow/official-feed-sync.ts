import type {
  MatchStatus,
  Prisma,
  PrismaClient,
  ResultQualityStatus,
} from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  fetchOfficialObservationsForDate,
  isOfficialGlasgowFeedEnabled,
  londonMatchTimePrefix,
  officialGlasgowFeedBaseUrl,
  officialSessionsUrl,
  type OfficialFeedObservation,
} from '@/lib/glasgow/official-feed';
import {
  GlasgowResultsImportService,
  type GlasgowMatchResultInput,
  type GlasgowResultsImportInput,
} from '@/lib/glasgow/results-import';
import { sourcePayloadChecksum } from '@/lib/sources/checksum';
import { safeErrorMessage } from '@/lib/safe-logging';
import { resolvePublicMatchAccess } from '@/lib/public-match';
import { broadcastCompletion } from '@/lib/broadcasting';
import {
  broadcastMatchStatus,
  broadcastScoreUpdate,
} from '@/lib/socket-server';

const GLASGOW_SOURCE_KEY = 'glasgow-2026-public-data';
const GLASGOW_EDITION_SLUG = 'glasgow-2026';
const GLASGOW_SERIES_SLUG = 'commonwealth-games-netball';
const MAX_BACKFILL_DATES = 14;
const HISTORICAL_CORRECTION_SWEEP_INTERVAL_MS = 15 * 60 * 1_000;
const EXPECTED_RESULT_GRACE_MS = 15 * 60 * 1_000;
const OFFICIAL_TEAM_CODE_ALIASES: Readonly<Record<string, string>> = {
  // The source bundle uses ISO-style codes while the official feed uses
  // Commonwealth Games organisation codes for these two teams.
  MAW: 'MWI',
  TGA: 'TON',
};

export type OfficialGlasgowSyncStatus =
  | 'success'
  | 'empty'
  | 'partial'
  | 'error';

export interface OfficialGlasgowSyncResult {
  status: OfficialGlasgowSyncStatus;
  matchesProcessed: number;
  issues: string[];
}

interface CurrentMappedMatch {
  externalId: string;
  match: {
    id: string;
    scheduledAt: Date;
    status: MatchStatus;
    resultQuality: ResultQualityStatus;
    homeScore: number;
    awayScore: number;
    homeTeamId: string | null;
    awayTeamId: string | null;
    sourceUpdatedAt: Date | null;
  };
}

interface PlannedUpdate {
  matchId: string;
  observation: OfficialFeedObservation;
  result: GlasgowMatchResultInput;
}

export interface OfficialGlasgowSyncDependencies {
  prisma?: PrismaClient;
  now?: () => Date;
  fetchForDate?: typeof fetchOfficialObservationsForDate;
  applyScheduled?: (
    input: GlasgowResultsImportInput,
  ) => Promise<{
    importRunId: string;
    checksum: string;
    inserted: number;
    updated: number;
    skipped: number;
    replayOfImportRunId: string | null;
  }>;
  broadcast?: (
    match: {
      id: string;
      status: MatchStatus;
      homeScore: number;
      awayScore: number;
      currentQuarter: number | null;
      currentTime: string | null;
      sourceUpdatedAt: Date | null;
    },
  ) => Promise<void>;
  historicalCorrectionSweepDue?: boolean;
}

let lastHistoricalCorrectionSweepAt: number | null = null;

function isObject(value: Prisma.JsonValue | null): value is Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function londonDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  if (!year || !month || !day) {
    throw new Error('Could not resolve the current Europe/London date');
  }
  return `${year}-${month}-${day}`;
}

function previousDate(date: string): string {
  const noonUtc = new Date(`${date}T12:00:00.000Z`);
  noonUtc.setUTCDate(noonUtc.getUTCDate() - 1);
  return noonUtc.toISOString().slice(0, 10);
}

function dedupeMappings(
  mappings: Array<{ externalId: string; internalEntityId: string }>,
  label: string,
  issues: string[],
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const mapping of mappings) {
    counts.set(mapping.externalId, (counts.get(mapping.externalId) ?? 0) + 1);
  }

  const result = new Map<string, string>();
  const reportedDuplicates = new Set<string>();
  for (const mapping of mappings) {
    if (counts.get(mapping.externalId) !== 1) {
      if (!reportedDuplicates.has(mapping.externalId)) {
        reportedDuplicates.add(mapping.externalId);
        issues.push(`${label} mapping ${mapping.externalId} is duplicated`);
      }
      continue;
    }
    result.set(mapping.externalId, mapping.internalEntityId);
  }
  return result;
}

function consumeHistoricalCorrectionSweep(now: Date): boolean {
  const nowMs = now.getTime();
  if (
    lastHistoricalCorrectionSweepAt === null
    || nowMs < lastHistoricalCorrectionSweepAt
    || nowMs - lastHistoricalCorrectionSweepAt
      >= HISTORICAL_CORRECTION_SWEEP_INTERVAL_MS
  ) {
    lastHistoricalCorrectionSweepAt = nowMs;
    return true;
  }
  return false;
}

function mappingDate(externalId: string): string | null {
  const date = externalId.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return null;
  }
  return date;
}

function latestResultsChecksum(
  runs: Array<{ checksum: string | null; metadata: Prisma.JsonValue | null }>,
): string | null {
  for (const run of runs) {
    if (
      run.checksum
      && isObject(run.metadata)
      && run.metadata.importKind === 'GLASGOW_RESULTS'
    ) {
      return run.checksum;
    }
  }
  return null;
}

function mappedTeamExternalId(providerCode: string): string {
  return OFFICIAL_TEAM_CODE_ALIASES[providerCode] ?? providerCode;
}

export function planOfficialGlasgowUpdates(
  observations: readonly OfficialFeedObservation[],
  mappedMatches: readonly CurrentMappedMatch[],
  teamIdByExternalId: ReadonlyMap<string, string>,
  retrievedAt: Date,
  latestAppliedChecksum: string | null,
): {
  updates: PlannedUpdate[];
  issues: string[];
  correction: GlasgowResultsImportInput['correction'];
} {
  const issues: string[] = [];
  const updates: PlannedUpdate[] = [];
  const providerCounts = new Map<string, number>();
  const resolution = observations.map((observation) => {
    providerCounts.set(
      observation.providerMatchCode,
      (providerCounts.get(observation.providerMatchCode) ?? 0) + 1,
    );
    const prefix = londonMatchTimePrefix(observation.startDate);
    const candidates = mappedMatches.filter((mapping) =>
      mapping.externalId.startsWith(prefix));
    return { prefix, candidates };
  });
  const externalIdCounts = new Map<string, number>();
  for (const item of resolution) {
    if (item.candidates.length !== 1) continue;
    const externalId = item.candidates[0].externalId;
    externalIdCounts.set(externalId, (externalIdCounts.get(externalId) ?? 0) + 1);
  }
  const reportedProviderCollisions = new Set<string>();
  const reportedFixtureCollisions = new Set<string>();

  for (const [index, observation] of observations.entries()) {
    if ((providerCounts.get(observation.providerMatchCode) ?? 0) > 1) {
      if (!reportedProviderCollisions.has(observation.providerMatchCode)) {
        issues.push(`Provider match ${observation.providerMatchCode} was returned more than once`);
        reportedProviderCollisions.add(observation.providerMatchCode);
      }
      continue;
    }
    const { prefix, candidates } = resolution[index];
    if (candidates.length !== 1) {
      issues.push(
        `Provider match ${observation.providerMatchCode} matched ${candidates.length} CentrePass fixtures for ${prefix}`,
      );
      continue;
    }
    const mapping = candidates[0];
    if ((externalIdCounts.get(mapping.externalId) ?? 0) > 1) {
      if (!reportedFixtureCollisions.has(mapping.externalId)) {
        issues.push(`CentrePass fixture ${mapping.externalId} received multiple provider matches`);
        reportedFixtureCollisions.add(mapping.externalId);
      }
      continue;
    }

    const sideAExternalId = mappedTeamExternalId(observation.sideAOrganisationCode);
    const sideBExternalId = mappedTeamExternalId(observation.sideBOrganisationCode);
    const sideATeamId = teamIdByExternalId.get(sideAExternalId);
    const sideBTeamId = teamIdByExternalId.get(sideBExternalId);
    if (!sideATeamId || !sideBTeamId || sideATeamId === sideBTeamId) {
      issues.push(
        `Provider match ${observation.providerMatchCode} has unmapped or duplicate teams`,
      );
      continue;
    }
    if (
      (mapping.match.homeTeamId && mapping.match.homeTeamId !== sideATeamId)
      || (mapping.match.awayTeamId && mapping.match.awayTeamId !== sideBTeamId)
    ) {
      issues.push(
        `Provider match ${observation.providerMatchCode} conflicts with the scheduled participants`,
      );
      continue;
    }
    if (!['SCHEDULED', 'LIVE', 'COMPLETED'].includes(mapping.match.status)) {
      issues.push(
        `CentrePass fixture ${mapping.externalId} is ${mapping.match.status} and cannot be updated automatically`,
      );
      continue;
    }
    if (mapping.match.status === 'COMPLETED' && observation.status === 'LIVE') {
      issues.push(
        `Provider match ${observation.providerMatchCode} attempted to reopen a completed fixture`,
      );
      continue;
    }
    if (
      mapping.match.status === 'LIVE'
      && (
        observation.sideAScore < mapping.match.homeScore
        || observation.sideBScore < mapping.match.awayScore
      )
    ) {
      issues.push(
        `Provider match ${observation.providerMatchCode} reported a live score regression`,
      );
      continue;
    }

    let resultQuality: ResultQualityStatus;
    if (observation.status === 'LIVE') {
      resultQuality = 'PROVISIONAL';
    } else if (mapping.match.status !== 'COMPLETED') {
      // Require the provider's OFFICIAL result to be identical on a second
      // successful poll before promoting it to OFFICIAL_FINAL.
      resultQuality = 'UNOFFICIAL_FINAL';
    } else {
      const scoreChanged = mapping.match.homeScore !== observation.sideAScore
        || mapping.match.awayScore !== observation.sideBScore;
      if (scoreChanged) {
        resultQuality = 'CORRECTED';
      } else if (mapping.match.resultQuality === 'UNOFFICIAL_FINAL') {
        resultQuality = 'OFFICIAL_FINAL';
      } else if (
        mapping.match.resultQuality === 'OFFICIAL_FINAL'
        || mapping.match.resultQuality === 'CORRECTED'
      ) {
        continue;
      } else {
        resultQuality = 'UNOFFICIAL_FINAL';
      }
    }

    const status = observation.status;
    const unchanged = mapping.match.status === status
      && mapping.match.resultQuality === resultQuality
      && mapping.match.homeScore === observation.sideAScore
      && mapping.match.awayScore === observation.sideBScore;
    if (unchanged) continue;

    updates.push({
      matchId: mapping.match.id,
      observation,
      result: {
        matchExternalId: mapping.externalId,
        sideAExternalId,
        sideBExternalId,
        status,
        resultQuality,
        sideAScore: observation.sideAScore,
        sideBScore: observation.sideBScore,
        sourceUpdatedAt: retrievedAt.toISOString(),
      },
    });
  }

  const hasCorrections = updates.some((update) =>
    update.result.resultQuality === 'CORRECTED');
  if (hasCorrections && !latestAppliedChecksum) {
    issues.push('A provider correction was quarantined because no prior results checksum exists');
  }
  const safeUpdates = latestAppliedChecksum
    ? updates
    : updates.filter((update) => update.result.resultQuality !== 'CORRECTED');

  return {
    updates: safeUpdates,
    issues,
    correction: hasCorrections && latestAppliedChecksum
      ? {
          reason: 'Automated correction from the official Commonwealth Sport result feed',
          correctsImportChecksum: latestAppliedChecksum,
        }
      : undefined,
  };
}

async function broadcastCanonicalMatch(
  match: {
    id: string;
    status: MatchStatus;
    homeScore: number;
    awayScore: number;
    currentQuarter: number | null;
    currentTime: string | null;
    sourceUpdatedAt: Date | null;
  },
): Promise<void> {
  const access = await resolvePublicMatchAccess(match.id).catch(() => null);
  if (!access || !match.sourceUpdatedAt) return;
  if (match.status === 'COMPLETED') {
    await broadcastCompletion(
      match.id,
      match.homeScore,
      match.awayScore,
      match.currentQuarter,
      match.sourceUpdatedAt,
    );
    return;
  }
  if (match.status !== 'LIVE') return;
  await broadcastScoreUpdate(match.id, {
    matchId: match.id,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    currentQuarter: match.currentQuarter,
    currentTime: match.currentTime,
  }, access, match.sourceUpdatedAt);
  await broadcastMatchStatus(match.id, {
    matchId: match.id,
    status: 'LIVE',
    quarter: match.currentQuarter,
    time: match.currentTime,
  }, access, match.sourceUpdatedAt);
}

export async function syncOfficialGlasgowResults(
  dependencies: OfficialGlasgowSyncDependencies = {},
): Promise<OfficialGlasgowSyncResult> {
  if (!isOfficialGlasgowFeedEnabled()) {
    return { status: 'empty', matchesProcessed: 0, issues: [] };
  }

  const db = dependencies.prisma ?? prisma;
  const now = (dependencies.now ?? (() => new Date()))();
  const retrievedAt = new Date(now);
  const fetchForDate = dependencies.fetchForDate ?? fetchOfficialObservationsForDate;
  const baseUrl = officialGlasgowFeedBaseUrl();

  const issues: string[] = [];
  try {
    const [edition, source] = await Promise.all([
      db.competition.findFirst({
        where: {
          slug: GLASGOW_EDITION_SLUG,
          series: { slug: GLASGOW_SERIES_SLUG },
        },
        select: { id: true, publicationStatus: true },
      }),
      db.sourceSystem.findUnique({
        where: { key: GLASGOW_SOURCE_KEY },
        select: { id: true, active: true },
      }),
    ]);
    if (!edition || edition.publicationStatus !== 'PUBLISHED') {
      throw new Error('The published Glasgow 2026 edition is unavailable');
    }
    if (!source || !source.active) {
      throw new Error('The Glasgow 2026 source system is unavailable');
    }

    const editionSource = await db.editionSource.findFirst({
      where: {
        competitionId: edition.id,
        sourceSystemId: source.id,
        externalId: GLASGOW_EDITION_SLUG,
        enabled: true,
      },
      select: { id: true },
    });
    if (!editionSource) {
      throw new Error('The enabled Glasgow 2026 edition source is unavailable');
    }

    const mappings = await db.sourceEntityMapping.findMany({
      where: {
        competitionId: edition.id,
        sourceSystemId: source.id,
        entityType: { in: ['MATCH', 'TEAM'] },
      },
      select: {
        entityType: true,
        externalId: true,
        internalEntityId: true,
      },
    });
    const matchIdByExternalId = dedupeMappings(
      mappings.filter((mapping) => mapping.entityType === 'MATCH'),
      'Match',
      issues,
    );
    const teamIdByExternalId = dedupeMappings(
      mappings.filter((mapping) => mapping.entityType === 'TEAM'),
      'Team',
      issues,
    );
    if (matchIdByExternalId.size === 0 || teamIdByExternalId.size === 0) {
      throw new Error('Glasgow source mappings are incomplete');
    }

    const [matches, recentRuns] = await Promise.all([
      db.match.findMany({
        where: {
          competitionId: edition.id,
          id: { in: [...matchIdByExternalId.values()] },
        },
        select: {
          id: true,
          scheduledAt: true,
          status: true,
          resultQuality: true,
          homeScore: true,
          awayScore: true,
          homeTeamId: true,
          awayTeamId: true,
          sourceUpdatedAt: true,
        },
      }),
      db.importRun.findMany({
        where: {
          competitionId: edition.id,
          sourceSystemId: source.id,
          status: 'SUCCEEDED',
          dryRun: false,
        },
        orderBy: { completedAt: 'desc' },
        take: 50,
        select: { checksum: true, metadata: true },
      }),
    ]);
    const matchById = new Map(matches.map((match) => [match.id, match]));
    const mappedMatches: CurrentMappedMatch[] = [];
    for (const [externalId, matchId] of matchIdByExternalId) {
      const match = matchById.get(matchId);
      if (!match) {
        issues.push(`Mapped Glasgow fixture ${externalId} does not exist`);
        continue;
      }
      mappedMatches.push({ externalId, match });
    }

    const today = londonDate(now);
    const dates = new Set([previousDate(today), today]);
    const historicalCorrectionSweepDue = dependencies.historicalCorrectionSweepDue
      ?? consumeHistoricalCorrectionSweep(now);
    for (const mapping of mappedMatches) {
      const fixtureDate = mappingDate(mapping.externalId);
      if (
        mapping.match.status === 'SCHEDULED'
        && mapping.match.scheduledAt.getTime() <= now.getTime()
        && fixtureDate
      ) {
        dates.add(fixtureDate);
      }
      if (
        historicalCorrectionSweepDue
        && fixtureDate
        && fixtureDate <= today
      ) {
        dates.add(fixtureDate);
      }
    }
    const selectedDates = [...dates].sort();
    if (selectedDates.length > MAX_BACKFILL_DATES) {
      issues.push(
        `Backfill requires ${selectedDates.length} dates; only the newest ${MAX_BACKFILL_DATES} were polled`,
      );
      selectedDates.splice(0, selectedDates.length - MAX_BACKFILL_DATES);
    }

    const observations: OfficialFeedObservation[] = [];
    const successfulDates: string[] = [];
    for (const date of selectedDates) {
      try {
        observations.push(...await fetchForDate(date, { baseUrl }));
        successfulDates.push(date);
      } catch (error) {
        issues.push(`Official feed ${date}: ${safeErrorMessage(error)}`);
      }
    }
    if (successfulDates.length === 0) {
      return { status: 'error', matchesProcessed: 0, issues };
    }

    const successfulDateSet = new Set(successfulDates);
    for (const mapping of mappedMatches) {
      const fixtureDate = mappingDate(mapping.externalId);
      if (!fixtureDate || !successfulDateSet.has(fixtureDate)) continue;
      const resultExpected = mapping.match.status === 'LIVE'
        || (
          mapping.match.status === 'COMPLETED'
          && mapping.match.resultQuality === 'UNOFFICIAL_FINAL'
        )
        || (
          mapping.match.status === 'SCHEDULED'
          && mapping.match.scheduledAt.getTime()
            <= now.getTime() - EXPECTED_RESULT_GRACE_MS
        );
      if (!resultExpected) continue;
      const observationCount = observations.filter((observation) =>
        mapping.externalId.startsWith(
          londonMatchTimePrefix(observation.startDate),
        )).length;
      if (observationCount !== 1) {
        issues.push(
          `Expected exactly one official observation for tracked fixture `
            + `${mapping.externalId}; received ${observationCount}`,
        );
      }
    }

    let currentLatestChecksum = latestResultsChecksum(recentRuns);
    const plan = planOfficialGlasgowUpdates(
      observations,
      mappedMatches,
      teamIdByExternalId,
      retrievedAt,
      currentLatestChecksum,
    );
    issues.push(...plan.issues);
    if (plan.updates.length === 0) {
      return {
        status: issues.length > 0 ? 'partial' : 'empty',
        matchesProcessed: 0,
        issues,
      };
    }

    const applyScheduled = dependencies.applyScheduled
      ?? ((payload: GlasgowResultsImportInput) =>
        new GlasgowResultsImportService(db).applyScheduled(payload));
    const appliedMatchIds: string[] = [];
    let applyFailures = 0;
    const orderedUpdates = plan.updates.toSorted((left, right) => (
      left.observation.startDate.localeCompare(right.observation.startDate)
      || left.observation.providerMatchCode.localeCompare(
        right.observation.providerMatchCode,
      )
    ));
    for (const update of orderedUpdates) {
      const stableArtifact = {
        provider: update.observation.provider,
        providerCompetitionId: update.observation.providerCompetitionId,
        matchExternalId: update.result.matchExternalId,
        providerMatchCode: update.observation.providerMatchCode,
        providerSessionId: update.observation.providerSessionId,
        providerEventCode: update.observation.providerEventCode,
        providerPhaseCode: update.observation.providerPhaseCode,
        providerGenderCode: update.observation.providerGenderCode,
        providerDisciplineCode: update.observation.providerDisciplineCode,
        providerSideAResultId: update.observation.providerSideAResultId,
        providerSideBResultId: update.observation.providerSideBResultId,
        startDate: update.observation.startDate,
        endDate: update.observation.endDate,
        status: update.observation.status,
        sideAOrganisationCode: update.observation.sideAOrganisationCode,
        sideBOrganisationCode: update.observation.sideBOrganisationCode,
        sideAScore: update.observation.sideAScore,
        sideBScore: update.observation.sideBScore,
      };
      const isCorrection = update.result.resultQuality === 'CORRECTED';
      if (isCorrection && !currentLatestChecksum) {
        issues.push(
          `Provider correction ${update.observation.providerMatchCode} has no current receipt base`,
        );
        applyFailures++;
        continue;
      }
      const input: GlasgowResultsImportInput = {
        schemaVersion: 1,
        edition: GLASGOW_EDITION_SLUG,
        sourceKey: GLASGOW_SOURCE_KEY,
        retrievedAt: retrievedAt.toISOString(),
        sourceManifest: {
          schemaVersion: 1,
          version: 'commonwealth-sport-glasgow-2026-v1',
          checksum: sourcePayloadChecksum([stableArtifact]),
          normalizedArtifact: [stableArtifact],
          sources: [
            ...successfulDates.map((date) => ({
              id: `sessions:${date}`,
              url: officialSessionsUrl(date, { baseUrl }),
              retrievedAt: retrievedAt.toISOString(),
              purpose: 'official netball session discovery',
            })),
            {
              id: `details:${update.observation.providerSessionId}:${update.observation.providerPhaseCode}`,
              url: update.observation.detailRequestUrl,
              retrievedAt: retrievedAt.toISOString(),
              purpose: 'official live or completed netball score',
            },
          ],
        },
        correction: isCorrection
          ? {
              reason: 'Automated correction from the official Commonwealth Sport result feed',
              correctsImportChecksum: currentLatestChecksum!,
            }
          : undefined,
        results: [update.result],
      };
      try {
        const receipt = await applyScheduled(input);
        currentLatestChecksum = receipt.checksum;
        appliedMatchIds.push(update.matchId);
      } catch (error) {
        applyFailures++;
        issues.push(
          `Scheduled result ${update.result.matchExternalId}: ${safeErrorMessage(error)}`,
        );
      }
    }

    if (appliedMatchIds.length === 0) {
      return {
        status: applyFailures > 0 ? 'error' : issues.length > 0 ? 'partial' : 'empty',
        matchesProcessed: 0,
        issues,
      };
    }

    const appliedMatches = await db.match.findMany({
      where: { id: { in: appliedMatchIds } },
      select: {
        id: true,
        status: true,
        homeScore: true,
        awayScore: true,
        currentQuarter: true,
        currentTime: true,
        sourceUpdatedAt: true,
      },
    });
    const broadcast = dependencies.broadcast ?? broadcastCanonicalMatch;
    for (const match of appliedMatches) {
      try {
        await broadcast(match);
      } catch (error) {
        issues.push(`Realtime broadcast ${match.id}: ${safeErrorMessage(error)}`);
      }
    }

    return {
      status: issues.length > 0 || applyFailures > 0 ? 'partial' : 'success',
      matchesProcessed: appliedMatchIds.length,
      issues,
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    console.error('[GlasgowFeed] Sync failed:', message);
    return {
      status: 'error',
      matchesProcessed: 0,
      issues: [...issues, message],
    };
  }
}
