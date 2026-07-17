import { cache } from 'react';
import type {
  DataCapability,
  MatchStatus,
  Prisma,
  ResultQualityStatus,
} from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  isEditionPubliclyReady,
  type CompetitionOption,
} from '@/lib/competitions';
import {
  isFinalFixture,
  resolveEditionFeatures,
  type EditionFeatureFlags,
} from '@/lib/edition-capabilities';

export interface PublicMatchAccess {
  id: string;
  competitionId: string;
  status: MatchStatus;
  resultQuality: ResultQualityStatus;
  scheduledAt: Date;
  homeTeamId: string | null;
  awayTeamId: string | null;
  features: EditionFeatureFlags;
}

const pendingLookups = new Map<string, Promise<PublicMatchAccess | null>>();

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
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      competitionId: true,
      status: true,
      resultQuality: true,
      scheduledAt: true,
      homeTeamId: true,
      awayTeamId: true,
      competition: { select: publicReadinessSelect },
      dataCoverage: { select: { capability: true, state: true } },
    },
  });

  if (
    !match
    || !isEditionPubliclyReady(match.competition as unknown as CompetitionOption)
  ) return null;

  return {
    id: match.id,
    competitionId: match.competitionId,
    status: match.status,
    resultQuality: match.resultQuality,
    scheduledAt: match.scheduledAt,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    features: resolveEditionFeatures(match.competition.dataCoverage, match.dataCoverage),
  };
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
