import { cache } from 'react';
import type {
  DataCapability,
  MatchStatus,
  Prisma,
  ResultQualityStatus,
} from '@prisma/client';
import { excludeSimData, prisma } from '@/lib/db';
import {
  isEditionPubliclyReady,
  type CompetitionOption,
  type PublicEditionPolicyOption,
} from '@/lib/competitions';
import {
  isFinalFixture,
  resolveEditionFeatures,
  type EditionFeatureFlags,
} from '@/lib/edition-capabilities';
import { timedQuery } from '@/lib/server-timing';

export interface PublicMatchAccess {
  id: string;
  competitionId: string;
  status: MatchStatus;
  resultQuality: ResultQualityStatus;
  scheduledAt: Date;
  homeTeamId: string | null;
  awayTeamId: string | null;
  /**
   * Durable provider-observation token for realtime ordering. A null value is
   * retained for legacy/manual rows that have never been observed by a feed.
   */
  sourceUpdatedAt: Date | null;
  features: EditionFeatureFlags;
}

const pendingLookups = new Map<string, Promise<PublicMatchAccess | null>>();
export const MAX_PUBLIC_MATCH_ACCESS_BATCH = 256;

const publicReadinessSelect = {
  id: true,
  slug: true,
  publicationStatus: true,
  series: { select: { slug: true } },
  dataCoverage: {
    where: { matchId: null },
    select: { capability: true, state: true },
  },
  _count: {
    select: {
      entries: { where: { status: 'ACTIVE' } },
      matches: true,
    },
  },
  stages: {
    orderBy: { sequence: 'asc' },
    select: {
      slug: true,
      type: true,
      sequence: true,
      isPublished: true,
      _count: { select: { groups: true, matches: true } },
    },
  },
  matches: { select: { _count: { select: { slots: true } } } },
  importRuns: {
    where: {
      sourceSystem: { key: 'glasgow-2026-public-data' },
      status: 'SUCCEEDED',
      dryRun: false,
      issueCount: 0,
    },
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.CompetitionSelect;

async function loadPublicMatchAccess(matchId: string): Promise<PublicMatchAccess | null> {
  const match = await timedQuery(
    'public_match_access',
    () => prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        competitionId: true,
        status: true,
        resultQuality: true,
        scheduledAt: true,
        homeTeamId: true,
        awayTeamId: true,
        sourceUpdatedAt: true,
        isSimulation: true,
        stageId: true,
        stage: { select: { isPublished: true } },
        competition: { select: publicReadinessSelect },
        dataCoverage: { select: { capability: true, state: true } },
      },
    }),
  );

  if (
    !match
    || (excludeSimData.isSimulation === false && match.isSimulation)
    || !isEditionPubliclyReady(match.competition as unknown as CompetitionOption)
    || (match.stageId !== null && match.stage?.isPublished !== true)
  ) return null;

  return {
    id: match.id,
    competitionId: match.competitionId,
    status: match.status,
    resultQuality: match.resultQuality,
    scheduledAt: match.scheduledAt,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    sourceUpdatedAt: match.sourceUpdatedAt,
    features: resolveEditionFeatures(match.competition.dataCoverage, match.dataCoverage),
  };
}

export const publicMatchBatchSelect = {
  id: true,
  competitionId: true,
  status: true,
  resultQuality: true,
  scheduledAt: true,
  homeTeamId: true,
  awayTeamId: true,
  sourceUpdatedAt: true,
  isSimulation: true,
  stageId: true,
  stage: { select: { isPublished: true } },
  dataCoverage: { select: { capability: true, state: true } },
} satisfies Prisma.MatchSelect;

export type PublicMatchAccessCandidate = Prisma.MatchGetPayload<{
  select: typeof publicMatchBatchSelect;
}>;

/**
 * Resolve many matches with one fresh match/capability query and at most one
 * edition-readiness query. Supplying already-loaded editions (for example the
 * result of getPublicCompetitions) removes the latter query without weakening
 * the readiness check.
 *
 * Database errors intentionally propagate. A missing map entry means policy
 * denial; a rejected promise means access infrastructure was unavailable.
 */
export async function resolvePublicMatchAccessBatch(
  matchIds: readonly string[],
  loadedEditions?: readonly PublicEditionPolicyOption[],
  loadedMatches?: readonly PublicMatchAccessCandidate[],
): Promise<ReadonlyMap<string, PublicMatchAccess>> {
  const uniqueIds = [...new Set(matchIds)];
  if (uniqueIds.length === 0) return new Map();
  if (uniqueIds.length > MAX_PUBLIC_MATCH_ACCESS_BATCH) {
    throw new RangeError(
      `Public match access batch exceeds ${MAX_PUBLIC_MATCH_ACCESS_BATCH} matches`,
    );
  }

  const matches = loadedMatches
    ? (() => {
      const matchById = new Map(loadedMatches.map((match) => [match.id, match]));
      return uniqueIds.flatMap((matchId) => {
        const match = matchById.get(matchId);
        return match ? [match] : [];
      });
    })()
    : await timedQuery(
      'public_match_access_batch',
      () => prisma.match.findMany({
        where: { id: { in: uniqueIds } },
        select: publicMatchBatchSelect,
      }),
    );
  if (matches.length === 0) return new Map();
  const competitionIds = [...new Set(matches.map((match) => match.competitionId))];
  const editions = loadedEditions ?? await timedQuery(
    'public_match_access_readiness',
    () => prisma.competition.findMany({
      where: { id: { in: competitionIds } },
      select: publicReadinessSelect,
    }) as Promise<PublicEditionPolicyOption[]>,
  );
  const readyEditions = new Map(
    editions
      .filter((edition) => (
        competitionIds.includes(edition.id)
        && isEditionPubliclyReady(edition)
      ))
      .map((edition) => [edition.id, edition]),
  );
  const resolved = new Map<string, PublicMatchAccess>();

  for (const match of matches) {
    const edition = readyEditions.get(match.competitionId);
    if (
      !edition
      || (excludeSimData.isSimulation === false && match.isSimulation)
      || (match.stageId !== null && match.stage?.isPublished !== true)
    ) continue;

    resolved.set(match.id, {
      id: match.id,
      competitionId: match.competitionId,
      status: match.status,
      resultQuality: match.resultQuality,
      scheduledAt: match.scheduledAt,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      sourceUpdatedAt: match.sourceUpdatedAt,
      features: resolveEditionFeatures(edition.dataCoverage, match.dataCoverage),
    });
  }

  return resolved;
}

/**
 * Resolve a match only when its owning edition passes the complete public
 * readiness policy. Concurrent lookups share one promise, but resolved access
 * is deliberately not retained: publication and coverage revocations must be
 * observed by the next HTTP request or realtime emission.
 */
export function resolvePublicMatchAccess(matchId: string): Promise<PublicMatchAccess | null> {
  const pending = pendingLookups.get(matchId);
  if (pending) return pending;

  const lookup = loadPublicMatchAccess(matchId).finally(() => {
    if (pendingLookups.get(matchId) === lookup) pendingLookups.delete(matchId);
  });
  pendingLookups.set(matchId, lookup);
  return lookup;
}

/** Request-scoped RSC deduplication; Socket.IO and API code use the uncached resolver. */
export const resolvePublicMatchForRequest = cache(resolvePublicMatchAccess);

export function hasPublicMatchCapability(
  access: PublicMatchAccess,
  capability: DataCapability,
): boolean {
  const featureByCapability: Partial<Record<DataCapability, keyof EditionFeatureFlags>> = {
    FINAL_SCORE: 'finalScore',
    PERIOD_SCORES: 'periodScores',
    TEAM_BOX_SCORE: 'teamBoxScore',
    PLAYER_BOX_SCORE: 'playerBoxScore',
    NET_POINTS: 'netPoints',
    MATCH_EVENTS: 'matchEvents',
    SCORE_FLOW: 'scoreFlow',
    SUPER_SHOTS: 'superShots',
    LINEUPS: 'lineups',
  };
  const feature = featureByCapability[capability];
  return feature ? access.features[feature].available : false;
}

export function isPublicMatchLiveOrFinal(access: PublicMatchAccess): boolean {
  return access.status === 'LIVE'
    || isFinalFixture(access.status, access.resultQuality);
}

export function canExposePublicMatchScore(access: PublicMatchAccess): boolean {
  return access.features.finalScore.available && isPublicMatchLiveOrFinal(access);
}
