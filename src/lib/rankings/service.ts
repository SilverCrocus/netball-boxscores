import {
  readComparisonPlayers,
  readEditionTeams,
  readTeamPowerMatches,
} from '@/lib/analytics/repository';
import {
  buildAnalyticsSnapshotCacheKey,
  readAnalyticsCacheEpoch,
} from '@/lib/analytics/cache-epoch';
import { getMetricDefinition } from '@/lib/analytics';
import { getCompetitionPlayerFacts } from '@/lib/player-analytics';
import { calculatePlayerRankingSnapshot } from '@/lib/rankings/player-rankings';
import { calculateTeamPowerSnapshot } from '@/lib/rankings/team-power';
import {
  PLAYER_RANKING_METHOD_VERSION,
  TEAM_POWER_METHOD_VERSION,
  type PlayerRankingRequest,
  type PlayerRankingSnapshot,
  type TeamPowerMatch,
} from '@/lib/rankings/types';
import { recordCacheResult, trackedUnstableCache } from '@/lib/server-timing';

const PLAYER_RANKING_CACHE_NAME = 'analytics_player_ranking_snapshot';
const TEAM_POWER_CACHE_NAME = 'analytics_team_power_snapshot';
const CACHE_REVALIDATE_SECONDS = 60 * 60;
const CACHE_TAG = 'analytics-snapshots';
const CACHEABLE_IDENTIFIER = /^[^\u0000-\u001f]{1,128}$/u;
const RANKING_POSITIONS = new Set(['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK']);

interface CachedPlayerRankingRequest {
  competitionId: string;
  metricId: string;
  aggregation: PlayerRankingRequest['aggregation'];
  position: string | null;
  stageId: string | null;
  stageGroupId: string | null;
  lastN: number | null;
  from: string | null;
  to: string | null;
  minimumMinutes: number;
}

type CachedPlayerRankingSnapshot = Omit<PlayerRankingSnapshot, 'request'> & {
  request: Omit<PlayerRankingRequest, 'from' | 'to'> & {
    from: string | null;
    to: string | null;
  };
};

function cacheableIdentifier(value: unknown, required = false): value is string {
  return typeof value === 'string'
    && (required || value.length > 0)
    && CACHEABLE_IDENTIFIER.test(value);
}

function dateToIso(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return null;
  return value.toISOString();
}

function normalizePlayerRankingRequest(request: PlayerRankingRequest): CachedPlayerRankingRequest | null {
  if (!cacheableIdentifier(request.competitionId, true)
    || !cacheableIdentifier(request.metricId, true)
    || !cacheableIdentifier(request.aggregation, true)
    || (request.position !== undefined && (!cacheableIdentifier(request.position, true) || !RANKING_POSITIONS.has(request.position)))
    || (request.stageId !== undefined && !cacheableIdentifier(request.stageId, true))
    || (request.stageGroupId !== undefined && !cacheableIdentifier(request.stageGroupId, true))
    || !Number.isFinite(request.minimumMinutes)
    || request.minimumMinutes < 0
    || request.minimumMinutes > 10_000
    || (request.lastN !== undefined && (!Number.isInteger(request.lastN) || request.lastN < 1 || request.lastN > 100))) {
    return null;
  }

  const metric = getMetricDefinition(request.metricId);
  if (!metric || !metric.entityTypes.includes('PLAYER') || !metric.allowedAggregations.includes(request.aggregation)) {
    return null;
  }

  const from = dateToIso(request.from);
  const to = dateToIso(request.to);
  if (from === null || to === null) return null;

  return {
    competitionId: request.competitionId,
    metricId: request.metricId,
    aggregation: request.aggregation,
    position: request.position ?? null,
    stageId: request.stageId ?? null,
    stageGroupId: request.stageGroupId ?? null,
    lastN: request.lastN ?? null,
    from: from ?? null,
    to: to ?? null,
    minimumMinutes: request.minimumMinutes,
  };
}

function restorePlayerRankingRequest(request: CachedPlayerRankingRequest): PlayerRankingRequest {
  return {
    competitionId: request.competitionId,
    metricId: request.metricId,
    aggregation: request.aggregation,
    ...(request.position ? { position: request.position } : {}),
    ...(request.stageId ? { stageId: request.stageId } : {}),
    ...(request.stageGroupId ? { stageGroupId: request.stageGroupId } : {}),
    ...(request.lastN !== null ? { lastN: request.lastN } : {}),
    ...(request.from ? { from: new Date(request.from) } : {}),
    ...(request.to ? { to: new Date(request.to) } : {}),
    minimumMinutes: request.minimumMinutes,
  };
}

export async function getPlayerRankingSnapshotUncached(request: PlayerRankingRequest): Promise<PlayerRankingSnapshot> {
  const facts = await getCompetitionPlayerFacts(request.competitionId);
  const playerIds = [...new Set(facts.map((fact) => fact.entityId))];
  const playerIdSet = new Set(playerIds);
  const players = (await readComparisonPlayers(request.competitionId))
    .filter((player) => playerIdSet.has(player.id));
  return calculatePlayerRankingSnapshot(
    facts,
    players.map((player) => ({
      id: player.id,
      name: player.name,
      position: player.position,
      teamName: player.teamName,
    })),
    request,
  );
}

function serializePlayerRankingSnapshot(snapshot: PlayerRankingSnapshot): CachedPlayerRankingSnapshot {
  return {
    ...snapshot,
    request: {
      ...snapshot.request,
      from: snapshot.request.from?.toISOString() ?? null,
      to: snapshot.request.to?.toISOString() ?? null,
    },
  };
}

function hydratePlayerRankingSnapshot(snapshot: CachedPlayerRankingSnapshot): PlayerRankingSnapshot {
  const { from, to, ...request } = snapshot.request;
  return {
    ...snapshot,
    request: {
      ...request,
      ...(from ? { from: new Date(from) } : {}),
      ...(to ? { to: new Date(to) } : {}),
    },
  };
}

const cachedPlayerRankingSnapshot = trackedUnstableCache(
  PLAYER_RANKING_CACHE_NAME,
  async (_cacheKey: string, request: CachedPlayerRankingRequest): Promise<CachedPlayerRankingSnapshot> =>
    serializePlayerRankingSnapshot(await getPlayerRankingSnapshotUncached(restorePlayerRankingRequest(request))),
  ['analytics-player-ranking-snapshot-v1'],
  {
    revalidate: CACHE_REVALIDATE_SECONDS,
    tags: [CACHE_TAG],
  },
);

export async function getPlayerRankingSnapshot(request: PlayerRankingRequest) {
  const epoch = await readAnalyticsCacheEpoch();
  const normalized = epoch ? normalizePlayerRankingRequest(request) : null;
  const metric = normalized ? getMetricDefinition(normalized.metricId) : undefined;
  const cacheKey = epoch && normalized && metric
    ? buildAnalyticsSnapshotCacheKey('player-ranking', epoch, {
      methodVersion: PLAYER_RANKING_METHOD_VERSION,
      formulaVersion: metric.formulaVersion,
      request: normalized,
    })
    : null;

  if (!cacheKey || !normalized || !epoch) {
    recordCacheResult(PLAYER_RANKING_CACHE_NAME, 'miss');
    return getPlayerRankingSnapshotUncached(request);
  }

  return hydratePlayerRankingSnapshot(await cachedPlayerRankingSnapshot(cacheKey, normalized));
}

export async function getTeamPowerSnapshotUncached(competitionId: string) {
  const [matches, teams] = await Promise.all([
    readTeamPowerMatches(competitionId),
    readEditionTeams(competitionId),
  ]);
  const powerMatches: TeamPowerMatch[] = matches.map((match) => ({
    id: match.match_id,
    competitionId: match.competition_id,
    competitionSeriesId: match.competition_series_id,
    competitionKind: match.competition_kind,
    scheduledAt: match.scheduled_at,
    sourceUpdatedAt: match.source_updated_at,
    neutralVenue: match.neutral_venue,
    homeTeamId: match.home_team_id,
    awayTeamId: match.away_team_id,
    homeScore: match.home_score,
    awayScore: match.away_score,
  }));
  return calculateTeamPowerSnapshot(
    competitionId,
    powerMatches,
    teams.map((team) => ({
      id: team.id,
      name: team.name,
      slug: team.slug,
      abbreviation: team.abbreviation,
    })),
  );
}

const cachedTeamPowerSnapshot = trackedUnstableCache(
  TEAM_POWER_CACHE_NAME,
  async (_cacheKey: string, competitionId: string) => getTeamPowerSnapshotUncached(competitionId),
  ['analytics-team-power-snapshot-v1'],
  {
    revalidate: CACHE_REVALIDATE_SECONDS,
    tags: [CACHE_TAG],
  },
);

export async function getTeamPowerSnapshot(competitionId: string) {
  const epoch = await readAnalyticsCacheEpoch();
  const cacheKey = epoch && cacheableIdentifier(competitionId, true)
    ? buildAnalyticsSnapshotCacheKey('team-power', epoch, {
      methodVersion: TEAM_POWER_METHOD_VERSION,
      competitionId,
    })
    : null;

  if (!cacheKey || !epoch) {
    recordCacheResult(TEAM_POWER_CACHE_NAME, 'miss');
    return getTeamPowerSnapshotUncached(competitionId);
  }

  return cachedTeamPowerSnapshot(cacheKey, competitionId);
}
