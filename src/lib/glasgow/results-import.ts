import { createHash, randomUUID } from 'node:crypto';
import type {
  CoverageState,
  ImportMutationOperation,
  ImportMutationTarget,
  MatchStatus,
  Prisma,
  PrismaClient,
  ResultQualityStatus,
} from '@prisma/client';
import { sourcePayloadChecksum } from '@/lib/sources/checksum';

const GLASGOW_IDENTITY = {
  competitionSlug: 'commonwealth-games-netball',
  editionSlug: 'glasgow-2026',
  sourceKey: 'glasgow-2026-public-data',
} as const;

const RESULT_STATUSES = new Set<MatchStatus>([
  'LIVE',
  'COMPLETED',
  'DELAYED',
  'POSTPONED',
  'CANCELLED',
  'ABANDONED',
]);
const RESULT_QUALITIES = new Set<ResultQualityStatus>([
  'UNKNOWN',
  'PROVISIONAL',
  'UNOFFICIAL_FINAL',
  'OFFICIAL_FINAL',
  'CORRECTED',
]);
const FINAL_QUALITIES = new Set<ResultQualityStatus>([
  'UNOFFICIAL_FINAL',
  'OFFICIAL_FINAL',
  'CORRECTED',
]);

export interface GlasgowResultPeriodInput {
  period: number;
  sideAScore: number;
  sideBScore: number;
}

export interface GlasgowMatchResultInput {
  matchExternalId: string;
  sideAExternalId: string;
  sideBExternalId: string;
  status: MatchStatus;
  resultQuality: ResultQualityStatus;
  sideAScore: number;
  sideBScore: number;
  sourceUpdatedAt: string;
  periods?: GlasgowResultPeriodInput[];
}

export interface GlasgowResultsSourceManifest {
  schemaVersion: 1;
  version: string;
  checksum: string;
  normalizedArtifact?: unknown;
  sources: Array<{
    id: string;
    url: string;
    retrievedAt: string;
    purpose: string;
  }>;
}

export interface GlasgowResultsImportInput {
  schemaVersion: 1;
  edition: 'glasgow-2026';
  sourceKey: 'glasgow-2026-public-data';
  retrievedAt: string;
  sourceManifest: GlasgowResultsSourceManifest;
  correction?: {
    reason: string;
    correctsImportChecksum: string;
  };
  results: GlasgowMatchResultInput[];
}

export interface GlasgowResultsIssue {
  code: string;
  message: string;
  matchExternalId?: string;
  fieldPath?: string;
}

export interface GlasgowResultsPreview {
  valid: boolean;
  checksum: string;
  confirmationToken: string | null;
  issues: GlasgowResultsIssue[];
  resultCount: number;
  latestAppliedChecksum: string | null;
  sourceManifest: {
    version: string;
    checksum: string;
    sourceCount: number;
  };
}

export interface GlasgowResultsImportReceipt {
  importRunId: string;
  checksum: string;
  inserted: number;
  updated: number;
  skipped: number;
  replayOfImportRunId: string | null;
}

interface ResolvedResult {
  input: GlasgowMatchResultInput;
  match: {
    id: string;
    competitionId: string;
    status: MatchStatus;
    resultQuality: ResultQualityStatus;
    homeScore: number;
    awayScore: number;
    homeTeamId: string | null;
    awayTeamId: string | null;
    sourceUpdatedAt: Date | null;
    stageGroupId: string | null;
    slots: Array<{
      id: string;
      side: 'A' | 'B';
      resolvedEntryId: string | null;
      sourceType: string;
    }>;
    quarters: Array<{
      id: string;
      quarter: number;
      homeScore: number;
      awayScore: number;
    }>;
  };
  sideA: { teamId: string; entryId: string };
  sideB: { teamId: string; entryId: string };
}

interface DatabasePreview extends GlasgowResultsPreview {
  editionId: string;
  sourceSystemId: string;
  rawPayloadStorageAllowed: boolean;
  editionSourceId: string;
  resolvedResults: ResolvedResult[];
  latestAppliedImportRunId: string | null;
}

type ResultsTransaction = Prisma.TransactionClient;
type ResultsApplyMode =
  | { kind: 'manual'; confirmationToken: string }
  | { kind: 'scheduled' };

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function rowJson(value: object): Prisma.InputJsonObject {
  return jsonValue(value) as Prisma.InputJsonObject;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function confirmationToken(
  editionId: string,
  checksum: string,
  latestAppliedChecksum: string | null,
): string {
  return createHash('sha256')
    .update(`${editionId}:${checksum}:${latestAppliedChecksum ?? 'FIRST_RESULT'}`)
    .digest('hex');
}

function receiptKind(metadata: Prisma.JsonValue | null): string | null {
  if (!isObject(metadata)) return null;
  return typeof metadata.importKind === 'string' ? metadata.importKind : null;
}

function validateIntegerScore(
  issues: GlasgowResultsIssue[],
  value: number,
  fieldPath: string,
  matchExternalId: string,
) {
  if (!Number.isSafeInteger(value) || value < 0) {
    issues.push({
      code: 'INVALID_SCORE',
      message: `${fieldPath} must be a non-negative safe integer`,
      matchExternalId,
      fieldPath,
    });
  }
}

export function validateGlasgowResultsInput(
  input: GlasgowResultsImportInput,
): GlasgowResultsIssue[] {
  const issues: GlasgowResultsIssue[] = [];
  if (!isObject(input)) {
    return [{ code: 'INVALID_PAYLOAD', message: 'Results import must be a JSON object' }];
  }
  if (input.schemaVersion !== 1) {
    issues.push({ code: 'INVALID_SCHEMA_VERSION', message: 'schemaVersion must be 1' });
  }
  if (input.edition !== GLASGOW_IDENTITY.editionSlug) {
    issues.push({ code: 'INVALID_EDITION', message: 'edition must be glasgow-2026' });
  }
  if (input.sourceKey !== GLASGOW_IDENTITY.sourceKey) {
    issues.push({
      code: 'INVALID_SOURCE',
      message: `sourceKey must be ${GLASGOW_IDENTITY.sourceKey}`,
    });
  }
  if (Number.isNaN(Date.parse(input.retrievedAt))) {
    issues.push({ code: 'INVALID_DATETIME', message: 'retrievedAt must be an ISO datetime' });
  }
  if (!isObject(input.sourceManifest)) {
    issues.push({ code: 'MISSING_SOURCE_MANIFEST', message: 'sourceManifest is required' });
  } else {
    if (input.sourceManifest.schemaVersion !== 1) {
      issues.push({ code: 'INVALID_SOURCE_MANIFEST', message: 'sourceManifest.schemaVersion must be 1' });
    }
    if (!input.sourceManifest.version?.trim()) {
      issues.push({ code: 'INVALID_SOURCE_MANIFEST', message: 'sourceManifest.version is required' });
    }
    if (!isSha256(input.sourceManifest.checksum ?? '')) {
      issues.push({
        code: 'INVALID_SOURCE_MANIFEST',
        message: 'sourceManifest.checksum must be a SHA-256 digest',
      });
    }
    if (input.sourceManifest.normalizedArtifact !== undefined) {
      const artifact = input.sourceManifest.normalizedArtifact;
      if (
        !Array.isArray(artifact)
        || artifact.length === 0
        || artifact.length > 100
        || artifact.some((item) => !isObject(item))
      ) {
        issues.push({
          code: 'INVALID_SOURCE_MANIFEST',
          message: 'sourceManifest.normalizedArtifact must contain 1 to 100 objects',
        });
      } else if (
        isSha256(input.sourceManifest.checksum ?? '')
        && sourcePayloadChecksum(artifact) !== input.sourceManifest.checksum
      ) {
        issues.push({
          code: 'SOURCE_MANIFEST_CHECKSUM_MISMATCH',
          message: 'sourceManifest.checksum must match normalizedArtifact',
        });
      }
    }
    if (!Array.isArray(input.sourceManifest.sources) || input.sourceManifest.sources.length === 0) {
      issues.push({
        code: 'INVALID_SOURCE_MANIFEST',
        message: 'sourceManifest.sources must contain at least one source',
      });
    } else {
      const sourceIds = new Set<string>();
      for (const [index, rawSource] of (input.sourceManifest.sources as unknown[]).entries()) {
        if (!isObject(rawSource)) {
          issues.push({
            code: 'INVALID_SOURCE_MANIFEST',
            message: `sourceManifest.sources[${index}] must be an object`,
          });
          continue;
        }
        const source = rawSource as unknown as GlasgowResultsSourceManifest['sources'][number];
        if (!source.id?.trim() || sourceIds.has(source.id)) {
          issues.push({
            code: 'INVALID_SOURCE_MANIFEST',
            message: `Source IDs must be non-empty and unique: ${source.id ?? ''}`,
          });
        }
        sourceIds.add(source.id);
        if (!isHttpUrl(source.url ?? '')) {
          issues.push({
            code: 'INVALID_SOURCE_MANIFEST',
            message: `Source ${source.id} must use an HTTP(S) URL`,
          });
        }
        if (Number.isNaN(Date.parse(source.retrievedAt))) {
          issues.push({
            code: 'INVALID_SOURCE_MANIFEST',
            message: `Source ${source.id} has an invalid retrievedAt`,
          });
        }
        if (!source.purpose?.trim()) {
          issues.push({
            code: 'INVALID_SOURCE_MANIFEST',
            message: `Source ${source.id} must state its purpose`,
          });
        }
      }
    }
  }

  if (!Array.isArray(input.results) || input.results.length === 0) {
    issues.push({ code: 'EMPTY_RESULTS', message: 'results must contain at least one match update' });
    return issues;
  }

  const matchIds = new Set<string>();
  let correctedCount = 0;
  for (const [index, rawResult] of (input.results as unknown[]).entries()) {
    if (!isObject(rawResult)) {
      issues.push({
        code: 'INVALID_RESULT',
        message: `results[${index}] must be an object`,
        fieldPath: `results.${index}`,
      });
      continue;
    }
    const result = rawResult as unknown as GlasgowMatchResultInput;
    const matchExternalId = result.matchExternalId;
    if (!matchExternalId?.trim()) {
      issues.push({ code: 'MISSING_MATCH_ID', message: 'matchExternalId is required' });
      continue;
    }
    if (matchIds.has(matchExternalId)) {
      issues.push({
        code: 'DUPLICATE_RESULT',
        message: `Duplicate result for ${matchExternalId}`,
        matchExternalId,
      });
    }
    matchIds.add(matchExternalId);
    if (!result.sideAExternalId?.trim() || !result.sideBExternalId?.trim()) {
      issues.push({
        code: 'MISSING_PARTICIPANT',
        message: 'Both side participant external IDs are required',
        matchExternalId,
      });
    } else if (result.sideAExternalId === result.sideBExternalId) {
      issues.push({
        code: 'DUPLICATE_PARTICIPANT',
        message: 'A match cannot contain the same participant on both sides',
        matchExternalId,
      });
    }
    if (!RESULT_STATUSES.has(result.status)) {
      issues.push({
        code: 'INVALID_STATUS',
        message: `Unsupported results status: ${result.status}`,
        matchExternalId,
      });
    }
    if (!RESULT_QUALITIES.has(result.resultQuality)) {
      issues.push({
        code: 'INVALID_RESULT_QUALITY',
        message: `Unsupported result quality: ${result.resultQuality}`,
        matchExternalId,
      });
    }
    validateIntegerScore(issues, result.sideAScore, 'sideAScore', matchExternalId);
    validateIntegerScore(issues, result.sideBScore, 'sideBScore', matchExternalId);
    if (Number.isNaN(Date.parse(result.sourceUpdatedAt))) {
      issues.push({
        code: 'INVALID_DATETIME',
        message: 'sourceUpdatedAt must be an ISO datetime',
        matchExternalId,
      });
    }

    if (result.status === 'LIVE' && result.resultQuality !== 'PROVISIONAL') {
      issues.push({
        code: 'INVALID_STATUS_QUALITY',
        message: 'LIVE results must use PROVISIONAL quality',
        matchExternalId,
      });
    } else if (
      result.status === 'COMPLETED'
      && !FINAL_QUALITIES.has(result.resultQuality)
    ) {
      issues.push({
        code: 'INVALID_STATUS_QUALITY',
        message: 'COMPLETED results require UNOFFICIAL_FINAL, OFFICIAL_FINAL, or CORRECTED quality',
        matchExternalId,
      });
    } else if (
      result.status !== 'LIVE'
      && result.status !== 'COMPLETED'
      && result.resultQuality !== 'UNKNOWN'
    ) {
      issues.push({
        code: 'INVALID_STATUS_QUALITY',
        message: `${result.status} results must use UNKNOWN quality`,
        matchExternalId,
      });
    }
    if (
      result.status !== 'LIVE'
      && result.status !== 'COMPLETED'
      && (result.sideAScore !== 0 || result.sideBScore !== 0 || (result.periods?.length ?? 0) > 0)
    ) {
      issues.push({
        code: 'INVALID_NONPLAYING_SCORE',
        message: `${result.status} updates cannot carry scores or periods`,
        matchExternalId,
      });
    }
    if (result.resultQuality === 'CORRECTED') correctedCount++;

    const periodNumbers = new Set<number>();
    let periodSideATotal = 0;
    let periodSideBTotal = 0;
    for (const period of result.periods ?? []) {
      if (!Number.isSafeInteger(period.period) || period.period < 1 || period.period > 8) {
        issues.push({
          code: 'INVALID_PERIOD',
          message: 'Period numbers must be safe integers from 1 to 8',
          matchExternalId,
          fieldPath: 'periods.period',
        });
      }
      if (periodNumbers.has(period.period)) {
        issues.push({
          code: 'DUPLICATE_PERIOD',
          message: `Duplicate period ${period.period}`,
          matchExternalId,
          fieldPath: 'periods.period',
        });
      }
      periodNumbers.add(period.period);
      validateIntegerScore(issues, period.sideAScore, 'periods.sideAScore', matchExternalId);
      validateIntegerScore(issues, period.sideBScore, 'periods.sideBScore', matchExternalId);
      periodSideATotal += period.sideAScore;
      periodSideBTotal += period.sideBScore;
    }
    const orderedPeriods = [...periodNumbers].toSorted((left, right) => left - right);
    if (orderedPeriods.some((period, index) => period !== index + 1)) {
      issues.push({
        code: 'NON_CONTIGUOUS_PERIODS',
        message: 'Periods must be unique and contiguous from period 1',
        matchExternalId,
      });
    }
    if (result.status === 'COMPLETED' && orderedPeriods.length > 0) {
      if (orderedPeriods.length < 4) {
        issues.push({
          code: 'INCOMPLETE_PERIODS',
          message: 'Completed period data must contain at least four regulation periods',
          matchExternalId,
        });
      }
      if (periodSideATotal !== result.sideAScore || periodSideBTotal !== result.sideBScore) {
        issues.push({
          code: 'PERIOD_TOTAL_MISMATCH',
          message: 'Completed period scores must sum exactly to the final score',
          matchExternalId,
        });
      }
    }
    if (
      result.status === 'LIVE'
      && (periodSideATotal > result.sideAScore || periodSideBTotal > result.sideBScore)
    ) {
      issues.push({
        code: 'PERIOD_TOTAL_MISMATCH',
        message: 'Completed live periods cannot exceed the current score',
        matchExternalId,
      });
    }
  }

  if (correctedCount > 0) {
    if (
      !input.correction?.reason?.trim()
      || !isSha256(input.correction.correctsImportChecksum ?? '')
    ) {
      issues.push({
        code: 'MISSING_CORRECTION_EVIDENCE',
        message: 'CORRECTED results require a reason and the corrected import checksum',
      });
    }
  } else if (input.correction) {
    issues.push({
      code: 'UNNEEDED_CORRECTION_EVIDENCE',
      message: 'correction metadata is only valid when at least one result uses CORRECTED quality',
    });
  }

  return issues;
}

function sameResultData(
  current: ResolvedResult['match'],
  incoming: GlasgowMatchResultInput,
): boolean {
  if (
    current.status !== incoming.status
    || current.homeScore !== incoming.sideAScore
    || current.awayScore !== incoming.sideBScore
  ) return false;
  const periods = incoming.periods ?? [];
  return current.quarters.length === periods.length
    && periods.every((period) => current.quarters.some((quarter) => (
      quarter.quarter === period.period
      && quarter.homeScore === period.sideAScore
      && quarter.awayScore === period.sideBScore
    )));
}

function sameResult(
  current: ResolvedResult['match'],
  incoming: GlasgowMatchResultInput,
): boolean {
  return current.resultQuality === incoming.resultQuality
    && sameResultData(current, incoming);
}

function validQualityTransition(
  current: ResultQualityStatus,
  incoming: ResultQualityStatus,
  dataChanged: boolean,
): boolean {
  if (!dataChanged && current === incoming) return true;
  if (incoming === 'CORRECTED') return true;
  if (current === 'UNKNOWN') return true;
  if (current === 'PROVISIONAL') {
    return incoming === 'PROVISIONAL'
      || incoming === 'UNOFFICIAL_FINAL'
      || incoming === 'OFFICIAL_FINAL';
  }
  if (current === 'UNOFFICIAL_FINAL') return incoming === 'OFFICIAL_FINAL';
  return false;
}

function sourceManifestReceipt(input: GlasgowResultsImportInput): Prisma.InputJsonObject {
  return {
    schemaVersion: input.sourceManifest.schemaVersion,
    version: input.sourceManifest.version,
    checksum: input.sourceManifest.checksum,
    sourceCount: input.sourceManifest.sources.length,
    sources: jsonValue(input.sourceManifest.sources),
    ...(input.sourceManifest.normalizedArtifact !== undefined
      ? { normalizedArtifact: jsonValue(input.sourceManifest.normalizedArtifact) }
      : {}),
  };
}

async function buildDatabasePreview(
  transaction: ResultsTransaction,
  input: GlasgowResultsImportInput,
): Promise<DatabasePreview> {
  const checksum = sourcePayloadChecksum(input);
  const issues = validateGlasgowResultsInput(input);
  if (!isObject(input)) {
    return {
      valid: false,
      checksum,
      confirmationToken: null,
      issues,
      resultCount: 0,
      latestAppliedChecksum: null,
      sourceManifest: { version: '', checksum: '', sourceCount: 0 },
      editionId: '',
      sourceSystemId: '',
      rawPayloadStorageAllowed: false,
      editionSourceId: '',
      resolvedResults: [],
      latestAppliedImportRunId: null,
    };
  }
  const usableResults = Array.isArray(input.results)
    ? (input.results as unknown[])
      .filter(isObject) as unknown as GlasgowMatchResultInput[]
    : [];
  const edition = await transaction.competition.findFirst({
    where: {
      series: { slug: GLASGOW_IDENTITY.competitionSlug },
      slug: GLASGOW_IDENTITY.editionSlug,
    },
    select: { id: true, publicationStatus: true },
  });
  if (!edition) {
    issues.push({ code: 'EDITION_NOT_FOUND', message: 'Glasgow 2026 edition was not found' });
  } else if (edition.publicationStatus !== 'PUBLISHED') {
    issues.push({
      code: 'EDITION_NOT_PUBLISHED',
      message: `The guarded results workflow requires PUBLISHED edition status; found ${edition.publicationStatus}`,
    });
  }

  const source = await transaction.sourceSystem.findUnique({
    where: { key: GLASGOW_IDENTITY.sourceKey },
    select: { id: true, rawPayloadStorageAllowed: true },
  });
  if (!source) issues.push({ code: 'SOURCE_NOT_FOUND', message: 'Glasgow source system was not found' });

  const editionSource = edition && source
    ? await transaction.editionSource.findFirst({
      where: {
        competitionId: edition.id,
        sourceSystemId: source.id,
        externalId: GLASGOW_IDENTITY.editionSlug,
        enabled: true,
      },
      select: { id: true },
    })
    : null;
  if (edition && source && !editionSource) {
    issues.push({ code: 'EDITION_SOURCE_NOT_FOUND', message: 'Enabled Glasgow edition source was not found' });
  }

  const editionId = edition?.id ?? '';
  const sourceSystemId = source?.id ?? '';
  const resultMatchIds = usableResults.map((result) => result.matchExternalId);
  const teamExternalIds = [...new Set(
    usableResults.flatMap((result) => [result.sideAExternalId, result.sideBExternalId]),
  )];

  const [matchMappings, teamMappings, recentRuns] = edition && source
    ? await Promise.all([
      transaction.sourceEntityMapping.findMany({
        where: {
          competitionId: edition.id,
          sourceSystemId: source.id,
          entityType: 'MATCH',
          externalId: { in: resultMatchIds },
        },
        select: { externalId: true, internalEntityId: true },
      }),
      transaction.sourceEntityMapping.findMany({
        where: {
          competitionId: edition.id,
          sourceSystemId: source.id,
          entityType: 'TEAM',
          externalId: { in: teamExternalIds },
        },
        select: { externalId: true, internalEntityId: true },
      }),
      transaction.importRun.findMany({
        where: {
          competitionId: edition.id,
          sourceSystemId: source.id,
          status: 'SUCCEEDED',
          dryRun: false,
        },
        orderBy: { completedAt: 'desc' },
        take: 50,
        select: { id: true, checksum: true, metadata: true },
      }),
    ])
    : [[], [], []];

  const resultsRuns = recentRuns.filter((run) => receiptKind(run.metadata) === 'GLASGOW_RESULTS');
  const latestApplied = resultsRuns[0] ?? null;
  if (
    input.correction
    && input.correction.correctsImportChecksum !== latestApplied?.checksum
  ) {
    issues.push({
      code: 'STALE_CORRECTION_BASE',
      message: `Correction must reference the latest applied results checksum ${latestApplied?.checksum ?? 'NONE'}`,
    });
  }

  const uniqueMapping = (
    mappings: Array<{ externalId: string; internalEntityId: string }>,
    type: 'MATCH' | 'TEAM',
  ) => {
    const result = new Map<string, string>();
    for (const mapping of mappings) {
      if (result.has(mapping.externalId)) {
        issues.push({
          code: 'DUPLICATE_SOURCE_MAPPING',
          message: `${type} ${mapping.externalId} has duplicate source mappings`,
        });
      }
      result.set(mapping.externalId, mapping.internalEntityId);
    }
    return result;
  };
  const matchIdByExternalId = uniqueMapping(matchMappings, 'MATCH');
  const teamIdByExternalId = uniqueMapping(teamMappings, 'TEAM');

  const [matches, entries] = edition
    ? await Promise.all([
      transaction.match.findMany({
        where: {
          competitionId: edition.id,
          id: { in: [...matchIdByExternalId.values()] },
        },
        select: {
          id: true,
          competitionId: true,
          status: true,
          resultQuality: true,
          homeScore: true,
          awayScore: true,
          homeTeamId: true,
          awayTeamId: true,
          sourceUpdatedAt: true,
          stageGroupId: true,
          slots: {
            select: { id: true, side: true, resolvedEntryId: true, sourceType: true },
            orderBy: { side: 'asc' },
          },
          quarters: {
            select: { id: true, quarter: true, homeScore: true, awayScore: true },
            orderBy: { quarter: 'asc' },
          },
        },
      }),
      transaction.editionEntry.findMany({
        where: {
          competitionId: edition.id,
          teamId: { in: [...teamIdByExternalId.values()] },
        },
        select: { id: true, teamId: true },
      }),
    ])
    : [[], []];

  const matchById = new Map(matches.map((match) => [match.id, match]));
  const entryByTeamId = new Map(entries.map((entry) => [entry.teamId, entry.id]));
  const resolvedResults: ResolvedResult[] = [];
  for (const result of usableResults) {
    const matchId = matchIdByExternalId.get(result.matchExternalId);
    const match = matchId ? matchById.get(matchId) : undefined;
    if (!matchId || !match) {
      issues.push({
        code: 'MATCH_NOT_FOUND',
        message: `Result match must already exist and be mapped: ${result.matchExternalId}`,
        matchExternalId: result.matchExternalId,
      });
      continue;
    }
    const sideATeamId = teamIdByExternalId.get(result.sideAExternalId);
    const sideBTeamId = teamIdByExternalId.get(result.sideBExternalId);
    const sideAEntryId = sideATeamId ? entryByTeamId.get(sideATeamId) : undefined;
    const sideBEntryId = sideBTeamId ? entryByTeamId.get(sideBTeamId) : undefined;
    if (!sideATeamId || !sideBTeamId || !sideAEntryId || !sideBEntryId) {
      issues.push({
        code: 'PARTICIPANT_NOT_FOUND',
        message: `Both result participants must already exist and be mapped for ${result.matchExternalId}`,
        matchExternalId: result.matchExternalId,
      });
      continue;
    }
    if (match.slots.length !== 2) {
      issues.push({
        code: 'INVALID_MATCH_SLOTS',
        message: `Existing match ${result.matchExternalId} must have exactly two slots`,
        matchExternalId: result.matchExternalId,
      });
      continue;
    }
    const sideASlot = match.slots.find((slot) => slot.side === 'A');
    const sideBSlot = match.slots.find((slot) => slot.side === 'B');
    if (!sideASlot || !sideBSlot) {
      issues.push({
        code: 'INVALID_MATCH_SLOTS',
        message: `Existing match ${result.matchExternalId} is missing side A or B`,
        matchExternalId: result.matchExternalId,
      });
      continue;
    }
    if (
      (sideASlot.resolvedEntryId && sideASlot.resolvedEntryId !== sideAEntryId)
      || (sideBSlot.resolvedEntryId && sideBSlot.resolvedEntryId !== sideBEntryId)
      || (match.homeTeamId && match.homeTeamId !== sideATeamId)
      || (match.awayTeamId && match.awayTeamId !== sideBTeamId)
    ) {
      issues.push({
        code: 'PARTICIPANT_MISMATCH',
        message: `Result participants conflict with the existing match resolution for ${result.matchExternalId}`,
        matchExternalId: result.matchExternalId,
      });
      continue;
    }
    const dataChanged = !sameResult(match, result);
    const canonicalResultChanged = !sameResultData(match, result);
    if (!validQualityTransition(match.resultQuality, result.resultQuality, dataChanged)) {
      issues.push({
        code: 'INVALID_QUALITY_TRANSITION',
        message: `Cannot transition ${match.resultQuality} to ${result.resultQuality} for ${result.matchExternalId}`,
        matchExternalId: result.matchExternalId,
      });
    }
    if (
      match.status === 'COMPLETED'
      && canonicalResultChanged
      && result.resultQuality !== 'CORRECTED'
    ) {
      issues.push({
        code: 'CORRECTION_REQUIRED',
        message: `Changing a completed result requires CORRECTED quality: ${result.matchExternalId}`,
        matchExternalId: result.matchExternalId,
      });
    }
    if (
      match.status === 'LIVE'
      && result.status === 'LIVE'
      && (result.sideAScore < match.homeScore || result.sideBScore < match.awayScore)
    ) {
      issues.push({
        code: 'SCORE_REGRESSION',
        message: `Live scores cannot decrease for ${result.matchExternalId}`,
        matchExternalId: result.matchExternalId,
      });
    }
    if (
      match.sourceUpdatedAt
      && Date.parse(result.sourceUpdatedAt) < match.sourceUpdatedAt.getTime()
      && dataChanged
    ) {
      issues.push({
        code: 'STALE_SOURCE_UPDATE',
        message: `Source update is older than the stored result for ${result.matchExternalId}`,
        matchExternalId: result.matchExternalId,
      });
    }
    if (
      result.periods
      && match.quarters.some((quarter) => !result.periods?.some((period) => period.period === quarter.quarter))
    ) {
      issues.push({
        code: 'PERIOD_SET_REGRESSION',
        message: `A correction must retain every previously stored period for ${result.matchExternalId}`,
        matchExternalId: result.matchExternalId,
      });
    }

    resolvedResults.push({
      input: result,
      match,
      sideA: { teamId: sideATeamId, entryId: sideAEntryId },
      sideB: { teamId: sideBTeamId, entryId: sideBEntryId },
    });
  }

  const token = edition && issues.length === 0
    ? confirmationToken(edition.id, checksum, latestApplied?.checksum ?? null)
    : null;
  return {
    valid: issues.length === 0,
    checksum,
    confirmationToken: token,
    issues,
    resultCount: input.results?.length ?? 0,
    latestAppliedChecksum: latestApplied?.checksum ?? null,
    sourceManifest: {
      version: input.sourceManifest?.version ?? '',
      checksum: input.sourceManifest?.checksum ?? '',
      sourceCount: input.sourceManifest?.sources?.length ?? 0,
    },
    editionId,
    sourceSystemId,
    rawPayloadStorageAllowed: source?.rawPayloadStorageAllowed ?? false,
    editionSourceId: editionSource?.id ?? '',
    resolvedResults,
    latestAppliedImportRunId: latestApplied?.id ?? null,
  };
}

function receiptMetadata(
  input: GlasgowResultsImportInput,
  preview: GlasgowResultsPreview,
  extra: Record<string, unknown> = {},
): Prisma.InputJsonValue {
  return jsonValue({
    importKind: 'GLASGOW_RESULTS',
    sourceManifest: sourceManifestReceipt(input),
    correction: input.correction ?? null,
    preview: {
      checksum: preview.checksum,
      resultCount: preview.resultCount,
      latestAppliedChecksum: preview.latestAppliedChecksum,
      confirmationToken: preview.confirmationToken,
    },
    ...extra,
  });
}

function publicPreview(preview: DatabasePreview): GlasgowResultsPreview {
  return {
    valid: preview.valid,
    checksum: preview.checksum,
    confirmationToken: preview.confirmationToken,
    issues: preview.issues,
    resultCount: preview.resultCount,
    latestAppliedChecksum: preview.latestAppliedChecksum,
    sourceManifest: preview.sourceManifest,
  };
}

function completionTimestamp(startedAt: Date): Date {
  return new Date(Math.max(Date.now(), startedAt.getTime()));
}

export class GlasgowResultsImportService {
  constructor(private readonly prisma: PrismaClient) {}

  async preview(input: GlasgowResultsImportInput): Promise<GlasgowResultsPreview> {
    const preview = await this.prisma.$transaction(
      (transaction) => buildDatabasePreview(transaction, input),
      { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 },
    );
    return publicPreview(preview);
  }

  async recordPreview(input: GlasgowResultsImportInput): Promise<{
    importRunId: string;
    preview: GlasgowResultsPreview;
  }> {
    return this.prisma.$transaction(async (transaction) => {
      const preview = await buildDatabasePreview(transaction, input);
      if (!preview.valid) throw new Error(`Results preview is not clean: ${preview.issues.map((issue) => issue.message).join('; ')}`);
      const importRunId = randomUUID();
      const recordedAt = new Date();
      await transaction.importRun.create({
        data: {
          id: importRunId,
          sourceSystemId: preview.sourceSystemId,
          competitionId: preview.editionId,
          editionSourceId: preview.editionSourceId,
          trigger: 'MANUAL',
          status: 'SUCCEEDED',
          dryRun: true,
          startedAt: recordedAt,
          completedAt: recordedAt,
          retrievedAt: new Date(input.retrievedAt),
          checksum: preview.checksum,
          issueCount: 0,
          metadata: receiptMetadata(input, preview, { previewRecorded: true }),
        },
      });
      return { importRunId, preview: publicPreview(preview) };
    }, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 });
  }

  async apply(
    input: GlasgowResultsImportInput,
    suppliedConfirmationToken: string,
  ): Promise<GlasgowResultsImportReceipt> {
    return this.applyWithMode(input, {
      kind: 'manual',
      confirmationToken: suppliedConfirmationToken,
    });
  }

  async applyScheduled(
    input: GlasgowResultsImportInput,
  ): Promise<GlasgowResultsImportReceipt> {
    return this.applyWithMode(input, { kind: 'scheduled' });
  }

  private async applyWithMode(
    input: GlasgowResultsImportInput,
    mode: ResultsApplyMode,
  ): Promise<GlasgowResultsImportReceipt> {
    const importRunId = randomUUID();
    const importStartedAt = new Date();
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const preview = await buildDatabasePreview(transaction, input);
        if (!preview.valid) {
          throw new Error(`Results preview is not clean: ${preview.issues.map((issue) => issue.message).join('; ')}`);
        }
        let matchingDryRun: { id: string; metadata: Prisma.JsonValue } | null = null;
        if (mode.kind === 'manual') {
          if (
            !preview.confirmationToken
            || mode.confirmationToken !== preview.confirmationToken
          ) {
            throw new Error('Results apply confirmation token does not match the current dry-run state');
          }
          const recordedPreviews = await transaction.importRun.findMany({
            where: {
              competitionId: preview.editionId,
              sourceSystemId: preview.sourceSystemId,
              status: 'SUCCEEDED',
              dryRun: true,
              checksum: preview.checksum,
              issueCount: 0,
            },
            orderBy: { completedAt: 'desc' },
            take: 20,
            select: { id: true, metadata: true },
          });
          matchingDryRun = recordedPreviews.find((run) => {
            if (receiptKind(run.metadata) !== 'GLASGOW_RESULTS' || !isObject(run.metadata)) return false;
            const storedPreview = run.metadata.preview;
            return isObject(storedPreview)
              && storedPreview.confirmationToken === mode.confirmationToken;
          }) ?? null;
          if (!matchingDryRun) {
            throw new Error('Results apply requires a recorded clean dry-run with the same confirmation token');
          }
        }

        const priorRuns = await transaction.importRun.findMany({
          where: {
            competitionId: preview.editionId,
            sourceSystemId: preview.sourceSystemId,
            status: 'SUCCEEDED',
            dryRun: false,
            checksum: preview.checksum,
          },
          orderBy: { completedAt: 'desc' },
          take: 20,
          select: { id: true, metadata: true },
        });
        const priorResultsRun = priorRuns.find((run) =>
          receiptKind(run.metadata) === 'GLASGOW_RESULTS') ?? null;
        await transaction.importRun.create({
          data: {
            id: importRunId,
            sourceSystemId: preview.sourceSystemId,
            competitionId: preview.editionId,
            editionSourceId: preview.editionSourceId,
            trigger: priorResultsRun
              ? 'REPLAY'
              : mode.kind === 'scheduled'
                ? 'SCHEDULED'
                : 'MANUAL',
            status: 'RUNNING',
            dryRun: false,
            startedAt: importStartedAt,
            retrievedAt: new Date(input.retrievedAt),
            checksum: preview.checksum,
            issueCount: 0,
            metadata: receiptMetadata(input, preview, {
              recordedPreviewImportRunId: matchingDryRun?.id ?? null,
              automated: mode.kind === 'scheduled',
              replayOfImportRunId: priorResultsRun?.id ?? null,
            }),
          },
        });

        if (priorResultsRun) {
          await transaction.importRun.update({
            where: { id: importRunId },
            data: {
              status: 'SUCCEEDED',
              completedAt: completionTimestamp(importStartedAt),
              skippedCount: preview.resultCount,
            },
          });
          return {
            importRunId,
            checksum: preview.checksum,
            inserted: 0,
            updated: 0,
            skipped: preview.resultCount,
            replayOfImportRunId: priorResultsRun.id,
          };
        }

        let sequence = 0;
        let inserted = 0;
        let updated = 0;
        const operationCounts: Record<ImportMutationOperation, number> = {
          INSERT: 0,
          UPDATE: 0,
          DELETE: 0,
        };
        const recordMutation = async (
          target: ImportMutationTarget,
          entityId: string,
          operation: ImportMutationOperation,
          before: object | null,
          after: object | null,
        ) => {
          sequence++;
          operationCounts[operation]++;
          if (operation === 'INSERT') inserted++;
          else updated++;
          await transaction.importMutation.create({
            data: {
              importRunId,
              sequence,
              operation,
              target,
              entityId,
              beforeData: before ? rowJson(before) : undefined,
              afterData: after ? rowJson(after) : undefined,
            },
          });
        };

        const resolvedResults = preview.resolvedResults.toSorted((left, right) =>
          left.input.matchExternalId.localeCompare(right.input.matchExternalId));
        for (const resolved of resolvedResults) {
          const result = resolved.input;
          const sideASlot = resolved.match.slots.find((slot) => slot.side === 'A')!;
          const sideBSlot = resolved.match.slots.find((slot) => slot.side === 'B')!;
          for (const [slot, entryId] of [
            [sideASlot, resolved.sideA.entryId],
            [sideBSlot, resolved.sideB.entryId],
          ] as const) {
            if (slot.resolvedEntryId === entryId) continue;
            const after = await transaction.matchSlot.update({
              where: { id: slot.id },
              data: {
                ...(slot.sourceType === 'UNRESOLVED'
                  ? {
                      sourceType: 'TEAM' as const,
                      sourceGroupId: null,
                      sourceRank: null,
                      sourceMatchId: null,
                    }
                  : {}),
                resolvedEntryId: entryId,
                resolvedAt: new Date(input.retrievedAt),
              },
            });
            await recordMutation('MATCH_SLOT', slot.id, 'UPDATE', slot, after);
          }

          const matchAfter = await transaction.match.update({
            where: { id: resolved.match.id },
            data: {
              homeTeamId: resolved.sideA.teamId,
              awayTeamId: resolved.sideB.teamId,
              homeScore: result.sideAScore,
              awayScore: result.sideBScore,
              status: result.status,
              resultQuality: result.resultQuality,
              sourceRetrievedAt: new Date(input.retrievedAt),
              sourceUpdatedAt: new Date(result.sourceUpdatedAt),
            },
          });
          await recordMutation('MATCH', matchAfter.id, 'UPDATE', resolved.match, matchAfter);

          for (const period of result.periods ?? []) {
            const before = resolved.match.quarters.find((quarter) => quarter.quarter === period.period) ?? null;
            const after = before
              ? await transaction.matchQuarter.update({
                where: { id: before.id },
                data: { homeScore: period.sideAScore, awayScore: period.sideBScore },
              })
              : await transaction.matchQuarter.create({
                data: {
                  matchId: resolved.match.id,
                  quarter: period.period,
                  homeScore: period.sideAScore,
                  awayScore: period.sideBScore,
                },
              });
            await recordMutation('MATCH_QUARTER', after.id, before ? 'UPDATE' : 'INSERT', before, after);
          }

          for (const capability of ['FINAL_SCORE', 'PERIOD_SCORES'] as const) {
            const before = await transaction.dataCoverage.findFirst({
              where: {
                competitionId: preview.editionId,
                matchId: resolved.match.id,
                capability,
              },
            });
            const state: CoverageState = capability === 'FINAL_SCORE'
              ? (result.status === 'LIVE' ? 'PROVISIONAL' : FINAL_QUALITIES.has(result.resultQuality) ? 'AVAILABLE' : 'UNAVAILABLE')
              : ((result.periods?.length ?? 0) > 0
                ? (result.status === 'LIVE' ? 'PROVISIONAL' : 'AVAILABLE')
                : 'UNAVAILABLE');
            const data = {
              sourceSystemId: preview.sourceSystemId,
              state,
              observedAt: new Date(input.retrievedAt),
              notes: capability === 'PERIOD_SCORES' && state === 'UNAVAILABLE'
                ? 'The source supplied a score without a period breakdown'
                : 'Updated by the guarded Glasgow results importer',
              details: jsonValue({
                resultsImportChecksum: preview.checksum,
                sourceManifestChecksum: input.sourceManifest.checksum,
              }),
            };
            const after = before
              ? await transaction.dataCoverage.update({ where: { id: before.id }, data })
              : await transaction.dataCoverage.create({
                data: {
                  competitionId: preview.editionId,
                  matchId: resolved.match.id,
                  capability,
                  ...data,
                },
              });
            await recordMutation('DATA_COVERAGE', after.id, before ? 'UPDATE' : 'INSERT', before, after);
          }

          if (result.status === 'COMPLETED' && FINAL_QUALITIES.has(result.resultQuality)) {
            const dependentSlots = await transaction.matchSlot.findMany({
              where: { sourceMatchId: resolved.match.id },
              orderBy: [{ matchId: 'asc' }, { side: 'asc' }],
            });
            if (result.sideAScore === result.sideBScore && dependentSlots.length > 0) {
              throw new Error(
                `Completed knockout source match ${resolved.match.id} cannot be a draw`,
              );
            }
            if (result.sideAScore === result.sideBScore) continue;
            const winnerEntryId = result.sideAScore > result.sideBScore
              ? resolved.sideA.entryId
              : resolved.sideB.entryId;
            const loserEntryId = result.sideAScore > result.sideBScore
              ? resolved.sideB.entryId
              : resolved.sideA.entryId;
            for (const slot of dependentSlots) {
              const resolvedEntryId = slot.sourceType === 'MATCH_WINNER'
                ? winnerEntryId
                : slot.sourceType === 'MATCH_LOSER'
                  ? loserEntryId
                  : null;
              if (!resolvedEntryId || slot.resolvedEntryId === resolvedEntryId) continue;
              const dependentMatch = await transaction.match.findUniqueOrThrow({
                where: { id: slot.matchId },
              });
              if (dependentMatch.status === 'LIVE' || dependentMatch.status === 'COMPLETED') {
                throw new Error(
                  `Cannot change a knockout slot after dependent match ${dependentMatch.id} has started`,
                );
              }
              const slotAfter = await transaction.matchSlot.update({
                where: { id: slot.id },
                data: { resolvedEntryId, resolvedAt: new Date(input.retrievedAt) },
              });
              await recordMutation('MATCH_SLOT', slot.id, 'UPDATE', slot, slotAfter);
              const entry = await transaction.editionEntry.findUniqueOrThrow({
                where: { id: resolvedEntryId },
                select: { teamId: true },
              });
              const matchData = slot.side === 'A'
                ? { homeTeamId: entry.teamId }
                : { awayTeamId: entry.teamId };
              const dependentAfter = await transaction.match.update({
                where: { id: dependentMatch.id },
                data: matchData,
              });
              await recordMutation('MATCH', dependentMatch.id, 'UPDATE', dependentMatch, dependentAfter);
            }
          }
        }

        const poolStage = await transaction.stage.findFirst({
          where: { competitionId: preview.editionId, type: 'POOL' },
          select: {
            id: true,
            groups: {
              orderBy: { id: 'asc' },
              select: {
                id: true,
                primaryEntries: {
                  where: { status: 'ACTIVE' },
                  orderBy: { id: 'asc' },
                  select: { id: true, seed: true, displayName: true },
                },
              },
            },
          },
        });
        if (!poolStage) throw new Error('Glasgow pool stage was not found during standings reconciliation');
        const poolMatches = await transaction.match.findMany({
          where: {
            competitionId: preview.editionId,
            stageId: poolStage.id,
            status: 'COMPLETED',
            resultQuality: { in: ['UNOFFICIAL_FINAL', 'OFFICIAL_FINAL', 'CORRECTED'] },
            isSimulation: false,
          },
          orderBy: { id: 'asc' },
          select: {
            stageGroupId: true,
            homeScore: true,
            awayScore: true,
            slots: {
              select: { side: true, resolvedEntryId: true },
              orderBy: { side: 'asc' },
            },
          },
        });
        for (const group of poolStage.groups) {
          const records = new Map(group.primaryEntries.map((entry) => [entry.id, {
            entry,
            played: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            goalsFor: 0,
            goalsAgainst: 0,
            points: 0,
          }]));
          for (const match of poolMatches.filter((candidate) => candidate.stageGroupId === group.id)) {
            const sideA = match.slots.find((slot) => slot.side === 'A')?.resolvedEntryId;
            const sideB = match.slots.find((slot) => slot.side === 'B')?.resolvedEntryId;
            const recordA = sideA ? records.get(sideA) : undefined;
            const recordB = sideB ? records.get(sideB) : undefined;
            if (!recordA || !recordB) {
              throw new Error(`Completed pool match has unresolved or out-of-group participants in ${group.id}`);
            }
            recordA.played++;
            recordB.played++;
            recordA.goalsFor += match.homeScore;
            recordA.goalsAgainst += match.awayScore;
            recordB.goalsFor += match.awayScore;
            recordB.goalsAgainst += match.homeScore;
            if (match.homeScore > match.awayScore) {
              recordA.wins++;
              recordA.points += 2;
              recordB.losses++;
            } else if (match.awayScore > match.homeScore) {
              recordB.wins++;
              recordB.points += 2;
              recordA.losses++;
            } else {
              recordA.draws++;
              recordB.draws++;
              recordA.points++;
              recordB.points++;
            }
          }
          const ranked = [...records.values()].toSorted((left, right) => {
            const leftPercentage = left.goalsAgainst > 0 ? left.goalsFor / left.goalsAgainst : 0;
            const rightPercentage = right.goalsAgainst > 0 ? right.goalsFor / right.goalsAgainst : 0;
            return right.points - left.points
              || rightPercentage - leftPercentage
              || (left.entry.seed ?? Number.MAX_SAFE_INTEGER) - (right.entry.seed ?? Number.MAX_SAFE_INTEGER)
              || (left.entry.displayName ?? left.entry.id).localeCompare(right.entry.displayName ?? right.entry.id);
          });
          for (const [index, record] of ranked.entries()) {
            const before = await transaction.stageStanding.findFirst({
              where: {
                stageId: poolStage.id,
                stageGroupId: group.id,
                editionEntryId: record.entry.id,
              },
            });
            const standingData = {
              rank: index + 1,
              played: record.played,
              wins: record.wins,
              losses: record.losses,
              draws: record.draws,
              goalsFor: record.goalsFor,
              goalsAgainst: record.goalsAgainst,
              goalPercentage: record.goalsAgainst > 0
                ? Number(((record.goalsFor / record.goalsAgainst) * 100).toFixed(1))
                : 0,
              points: record.points,
              tiebreakData: jsonValue({ strategy: 'INTERNATIONAL_POOL_2_1_0', seed: record.entry.seed }),
            };
            const after = before
              ? await transaction.stageStanding.update({ where: { id: before.id }, data: standingData })
              : await transaction.stageStanding.create({
                data: {
                  stageId: poolStage.id,
                  stageGroupId: group.id,
                  editionEntryId: record.entry.id,
                  ...standingData,
                },
              });
            await recordMutation('STAGE_STANDING', after.id, before ? 'UPDATE' : 'INSERT', before, after);
          }
        }

        const snapshotDedupeKey = `${preview.sourceSystemId}:${preview.editionId}:results:${preview.checksum}`;
        await transaction.sourceSnapshot.upsert({
          where: { dedupeKey: snapshotDedupeKey },
          update: { importRunId },
          create: {
            dedupeKey: snapshotDedupeKey,
            sourceSystemId: preview.sourceSystemId,
            importRunId,
            competitionId: preview.editionId,
            entityType: 'COMPETITION_EDITION',
            externalId: GLASGOW_IDENTITY.editionSlug,
            sourceUrl: input.sourceManifest.sources[0]?.url,
            retrievedAt: new Date(input.retrievedAt),
            checksum: preview.checksum,
            rawPayload: preview.rawPayloadStorageAllowed ? jsonValue(input) : undefined,
            metadata: jsonValue({
              importKind: 'GLASGOW_RESULTS',
              sourceManifest: sourceManifestReceipt(input),
              resultCount: preview.resultCount,
            }),
          },
        });
        await transaction.importRun.update({
          where: { id: importRunId },
          data: {
            status: 'SUCCEEDED',
            completedAt: completionTimestamp(importStartedAt),
            insertedCount: inserted,
            updatedCount: updated,
            skippedCount: 0,
            metadata: receiptMetadata(input, preview, {
              recordedPreviewImportRunId: matchingDryRun?.id ?? null,
              automated: mode.kind === 'scheduled',
              mutationOperations: operationCounts,
            }),
          },
        });
        await transaction.editionSource.update({
          where: { id: preview.editionSourceId },
          data: { lastSyncedAt: new Date(input.retrievedAt) },
        });
        return {
          importRunId,
          checksum: preview.checksum,
          inserted,
          updated,
          skipped: 0,
          replayOfImportRunId: null,
        };
      }, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 120_000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await this.prisma.importRun.create({
          data: {
            id: importRunId,
            sourceSystem: { connect: { key: GLASGOW_IDENTITY.sourceKey } },
            trigger: mode.kind === 'scheduled' ? 'SCHEDULED' : 'MANUAL',
            status: 'FAILED',
            dryRun: false,
            startedAt: importStartedAt,
            completedAt: completionTimestamp(importStartedAt),
            retrievedAt: new Date(input.retrievedAt),
            checksum: sourcePayloadChecksum(input),
            errorMessage: message,
            metadata: jsonValue({
              importKind: 'GLASGOW_RESULTS',
              sourceManifest: input.sourceManifest,
            }),
          },
        });
      } catch {
        // Preserve the original transactional error if the failure receipt also fails.
      }
      throw error;
    }
  }
}
