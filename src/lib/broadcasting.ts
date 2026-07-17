import { prisma } from '@/lib/db';
import { pickStatFields } from '@/lib/stat-utils';
import {
  broadcastScoreUpdate,
  broadcastMatchStatus,
  broadcastStatsUpdate,
  broadcastScoreFlowAdd,
  broadcastStatEvent,
} from '@/lib/socket-server';
import type { CDMatchStatsResponse } from '@/types/champion-data';
import type { StatEventPayload } from '@/types/socket';
import type { ChangeResult } from '@/lib/processing';
import type { Prisma } from '@prisma/client';
import { getScoreFlowIdentity } from '@/lib/score-flow';
import {
  isPublicMatchLiveOrFinal,
  resolvePublicMatchAccess,
  type PublicMatchAccess,
} from '@/lib/public-match';

// ── Score flow delta tracking ──

const matchScoreFlowSnapshots = new Map<string, Map<string, string>>();

async function publicAccessForBroadcast(
  matchId: string,
  providedAccess?: PublicMatchAccess | null,
): Promise<PublicMatchAccess | null> {
  // Treat supplied access as a hint only. Publication/capability state can be
  // revoked during any awaited database work, and the socket layer performs a
  // second final-boundary check immediately before emitting.
  void providedAccess;
  return resolvePublicMatchAccess(matchId).catch(() => null);
}

export function resetScoreFlowTracking(): void {
  matchScoreFlowSnapshots.clear();
}

export async function broadcastScoreFlowDelta(
  matchId: string,
  providedAccess?: PublicMatchAccess | null,
): Promise<void> {
  const access = await publicAccessForBroadcast(matchId, providedAccess);
  if (!access || !isPublicMatchLiveOrFinal(access) || !access.features.scoreFlow.available) {
    matchScoreFlowSnapshots.delete(matchId);
    return;
  }

  const allEntries = await prisma.scoreFlow.findMany({
    where: { matchId },
    include: { scorerPlayer: { select: { id: true, name: true } } },
    orderBy: [
      { period: 'asc' },
      { periodSeconds: 'asc' },
      { homeScore: 'asc' },
      { awayScore: 'asc' },
      { scoringTeamId: 'asc' },
    ],
  });

  const previous = matchScoreFlowSnapshots.get(matchId) ?? new Map<string, string>();
  const next = new Map<string, string>();

  for (const sf of allEntries) {
    const identity = getScoreFlowIdentity(sf);
    const signature = JSON.stringify([
      sf.homeScore,
      sf.awayScore,
      sf.scorePoints,
      sf.scorerPlayer?.id ?? null,
    ]);
    next.set(identity, signature);
    if (previous.get(identity) === signature) continue;

    await broadcastScoreFlowAdd(matchId, {
      matchId,
      period: sf.period,
      periodSeconds: sf.periodSeconds,
      scoringTeamId: sf.scoringTeamId,
      homeScore: sf.homeScore,
      awayScore: sf.awayScore,
      scorePoints: sf.scorePoints,
      scorerPlayerId: sf.scorerPlayer?.id,
      scorerName: sf.scorerPlayer?.name,
    }, access);
  }

  matchScoreFlowSnapshots.set(matchId, next);
}

// ── Match changes broadcast ──

type DbMatchWithTeams = {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: { id: string; name: string; abbreviation: string; logoUrl: string | null; championDataTeamId: number | null };
  awayTeam: { id: string; name: string; abbreviation: string; logoUrl: string | null; championDataTeamId: number | null };
};

export async function broadcastMatchChanges(
  changes: ChangeResult,
  matchDetail: CDMatchStatsResponse,
  _dbMatch: unknown,
  providedAccess?: PublicMatchAccess | null,
): Promise<void> {
  // Retained for caller compatibility while match-change broadcasts use the validated delta.
  void _dbMatch;
  if (!changes.matchId) return;
  const access = await publicAccessForBroadcast(changes.matchId, providedAccess);
  if (!access || !isPublicMatchLiveOrFinal(access)) return;

  if (changes.scoreChanged) {
    await broadcastScoreUpdate(changes.matchId, {
      matchId: changes.matchId,
      homeScore: changes.newHomeScore,
      awayScore: changes.newAwayScore,
      currentQuarter: changes.currentQuarter,
      currentTime: changes.currentTime,
    }, access);
  }

  if (
    changes.statusChanged
    && (changes.newStatus === 'LIVE' || changes.newStatus === 'COMPLETED')
  ) {
    const isCompletion = changes.newStatus === 'COMPLETED';
    await broadcastMatchStatus(changes.matchId, {
      matchId: changes.matchId,
      status: changes.newStatus,
      quarter: changes.currentQuarter,
      time: isCompletion ? '0' : changes.currentTime,
    }, access);
    if (isCompletion) {
      await broadcastScoreUpdate(changes.matchId, {
        matchId: changes.matchId,
        homeScore: changes.newHomeScore,
        awayScore: changes.newAwayScore,
        currentQuarter: changes.currentQuarter,
        currentTime: '0',
      }, access);
    }
  }

  if (matchDetail.playerStats) {
    await broadcastPlayerStats(changes.matchId, matchDetail, access);
  }

  await broadcastScoreFlowDelta(changes.matchId, access);
}

// ── Player stats broadcast ──

export async function broadcastPlayerStats(
  matchId: string,
  matchDetail: CDMatchStatsResponse,
  providedAccess?: PublicMatchAccess | null,
): Promise<void> {
  if (!matchDetail.playerStats) return;
  const access = await publicAccessForBroadcast(matchId, providedAccess);
  if (!access || !isPublicMatchLiveOrFinal(access) || !access.features.playerBoxScore.available) return;

  const allPlayerStats = [
    ...(matchDetail.playerStats.home ?? []),
    ...(matchDetail.playerStats.away ?? []),
  ];

  const players = await prisma.player.findMany({
    where: { championDataPlayerId: { in: allPlayerStats.map((ps) => ps.playerId) } },
    select: { id: true, championDataPlayerId: true },
  });
  const playerIdMap = new Map(players.map((p) => [p.championDataPlayerId, p.id]));

  const statsPayload = allPlayerStats
    .filter((ps) => playerIdMap.has(ps.playerId))
    .map((ps) => ({
      playerId: playerIdMap.get(ps.playerId)!,
      ...(access.features.lineups.available && ps.position
        ? { currentPosition: ps.position }
        : {}),
      ...pickStatFields(ps),
    }));

  if (statsPayload.length > 0) {
    await broadcastStatsUpdate(matchId, { matchId, playerStats: statsPayload }, access);
  }
}

// ── Stat events (intercepts, deflections, rebounds, turnovers) ──

type EventType = 'intercept' | 'deflection' | 'rebound' | 'turnover';

const STAT_TO_EVENT: { field: 'intercepts' | 'deflections' | 'rebounds' | 'turnovers'; type: EventType }[] = [
  { field: 'intercepts', type: 'intercept' },
  { field: 'deflections', type: 'deflection' },
  { field: 'rebounds', type: 'rebound' },
  { field: 'turnovers', type: 'turnover' },
];

function statEventIdentity(event: {
  playerId: string;
  type: string;
  period: number;
  periodSeconds: number;
}): string {
  return `${event.playerId}\u0000${event.type}\u0000${event.period}\u0000${event.periodSeconds}`;
}

type StatEventClient = Pick<Prisma.TransactionClient, 'player' | 'matchEvent'>;

/**
 * Persist inferred canonical events before aggregate rows are updated. The
 * returned payloads correspond only to rows inserted by this call, so a
 * concurrent poll that loses a skipDuplicates race cannot rebroadcast them.
 */
export async function persistStatEvents(
  matchId: string,
  matchDetail: CDMatchStatsResponse,
  dbMatch: DbMatchWithTeams,
  oldStatMap: Map<string, Record<EventType, number>>,
  period: number,
  periodSeconds: number,
  db: StatEventClient = prisma,
): Promise<StatEventPayload[]> {
  const allPlayerStats = [
    ...(matchDetail.playerStats.home ?? []).map((stats) => ({ stats, isHome: true })),
    ...(matchDetail.playerStats.away ?? []).map((stats) => ({ stats, isHome: false })),
  ];

  const players = await db.player.findMany({
    where: { championDataPlayerId: { in: allPlayerStats.map(({ stats }) => stats.playerId) } },
    select: { id: true, name: true, championDataPlayerId: true },
  });
  const playerMap = new Map(players.map((p) => [p.championDataPlayerId, p]));

  const eventsToCreate: Array<{
    matchId: string;
    playerId: string;
    type: string;
    period: number;
    periodSeconds: number;
    teamId: string;
  }> = [];
  const candidatePayloads = new Map<string, Omit<StatEventPayload, 'eventId'>>();

  for (const { stats: ps, isHome } of allPlayerStats) {
    const player = playerMap.get(ps.playerId);
    if (!player) continue;

    const oldStats = oldStatMap.get(player.id) ?? { intercept: 0, deflection: 0, rebound: 0, turnover: 0 };

    for (const { field, type } of STAT_TO_EVENT) {
      const current = (ps[field] ?? 0) as number;
      const previous = oldStats[type];
      const newCount = current - previous;
      if (newCount <= 0) continue;

      const team = isHome ? dbMatch.homeTeam : dbMatch.awayTeam;

      for (let i = 0; i < newCount; i++) {
        // Offset each event by 1 second to satisfy unique constraint
        const offsetSeconds = periodSeconds + i;
        eventsToCreate.push({
          matchId,
          playerId: player.id,
          type,
          period,
          periodSeconds: offsetSeconds,
          teamId: team.id,
        });

        const payload = {
          matchId,
          type,
          playerId: player.id,
          playerName: player.name,
          teamId: team.id,
          teamName: team.name,
          teamAbbreviation: team.abbreviation,
          teamLogoUrl: team.logoUrl,
          isHomeTeam: isHome,
          quarter: period,
          time: String(offsetSeconds),
        } satisfies Omit<StatEventPayload, 'eventId'>;
        candidatePayloads.set(statEventIdentity({
          playerId: player.id,
          type,
          period,
          periodSeconds: offsetSeconds,
        }), payload);
      }
    }
  }

  if (eventsToCreate.length === 0) return [];

  const inserted = await db.matchEvent.createManyAndReturn({
    data: eventsToCreate,
    skipDuplicates: true,
    select: {
      id: true,
      playerId: true,
      type: true,
      period: true,
      periodSeconds: true,
    },
  });

  return inserted.flatMap((event) => {
    const payload = candidatePayloads.get(statEventIdentity(event));
    return payload ? [{ eventId: event.id, ...payload }] : [];
  });
}

/** Emit only events proven newly committed by persistStatEvents. */
export async function broadcastPersistedStatEvents(
  matchId: string,
  events: readonly StatEventPayload[],
): Promise<void> {
  if (events.length === 0) return;
  const access = await publicAccessForBroadcast(matchId);
  if (!access || !isPublicMatchLiveOrFinal(access) || !access.features.matchEvents.available) return;

  for (const event of events) {
    await broadcastStatEvent(matchId, event, access);
  }
}

// ── Completion broadcast helper ──

export async function broadcastCompletion(
  matchId: string,
  homeScore: number,
  awayScore: number,
  finalQuarter: number,
): Promise<void> {
  const access = await publicAccessForBroadcast(matchId);
  if (!access || !isPublicMatchLiveOrFinal(access)) return;

  await broadcastMatchStatus(matchId, {
    matchId,
    status: 'COMPLETED',
    quarter: finalQuarter,
    time: '0',
  }, access);
  await broadcastScoreUpdate(matchId, {
    matchId,
    homeScore,
    awayScore,
    currentQuarter: finalQuarter,
    currentTime: '0',
  }, access);
}
