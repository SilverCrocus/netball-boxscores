import { prisma } from '@/lib/db';
import { pickStatFields } from '@/lib/stat-utils';
import {
  broadcastScoreUpdate,
  broadcastMatchStatus,
  broadcastStatsUpdate,
  broadcastScoreFlowSnapshot,
  broadcastStatEventsSnapshot,
} from '@/lib/socket-server';
import type { CDMatchStatsResponse } from '@/types/champion-data';
import type { StatEventPayload } from '@/types/socket';
import type { ChangeResult } from '@/lib/processing';
import type { Prisma } from '@prisma/client';
import {
  isPublicMatchLiveOrFinal,
  resolvePublicMatchAccess,
  type PublicMatchAccess,
} from '@/lib/public-match';

async function publicAccessForBroadcast(
  matchId: string,
  providedAccess?: PublicMatchAccess | null,
  expectedRevision?: Date | string | null,
): Promise<PublicMatchAccess | null> {
  // Treat supplied access as a hint only. Publication/capability state can be
  // revoked during any awaited database work, and the socket layer performs a
  // second final-boundary check immediately before emitting.
  void providedAccess;
  const access = await resolvePublicMatchAccess(matchId).catch(() => null);
  const expected = expectedRevision instanceof Date
    ? expectedRevision.toISOString()
    : expectedRevision;
  if (expected && access?.sourceUpdatedAt?.toISOString() !== expected) return null;
  return access;
}

export function resetScoreFlowTracking(): void {
  // Kept for compatibility with existing worker/test setup. Score-flow now
  // emits a complete canonical snapshot and holds no process-local cursor.
}

export async function broadcastScoreFlowDelta(
  matchId: string,
  providedAccess?: PublicMatchAccess | null,
  expectedRevision?: Date | string | null,
): Promise<void> {
  const access = await publicAccessForBroadcast(matchId, providedAccess, expectedRevision);
  if (!access || !isPublicMatchLiveOrFinal(access) || !access.features.scoreFlow.available) {
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

  await broadcastScoreFlowSnapshot(matchId, {
    matchId,
    entries: allEntries.map((sf) => ({
      matchId,
      period: sf.period,
      periodSeconds: sf.periodSeconds,
      scoringTeamId: sf.scoringTeamId,
      homeScore: sf.homeScore,
      awayScore: sf.awayScore,
      scorePoints: sf.scorePoints,
      scorerPlayerId: sf.scorerPlayer?.id,
      scorerName: sf.scorerPlayer?.name,
    })),
  }, access, expectedRevision);
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
  expectedRevision?: Date | string | null,
): Promise<void> {
  // Retained for caller compatibility while match-change broadcasts use the validated delta.
  void _dbMatch;
  if (!changes.matchId) return;
  const access = await publicAccessForBroadcast(
    changes.matchId,
    providedAccess,
    expectedRevision,
  );
  if (!access || !isPublicMatchLiveOrFinal(access)) return;

  const canonical = await prisma.match.findUnique({
    where: { id: changes.matchId },
    select: {
      status: true,
      homeScore: true,
      awayScore: true,
      currentQuarter: true,
      currentTime: true,
      sourceUpdatedAt: true,
    },
  });
  const expected = expectedRevision instanceof Date
    ? expectedRevision.toISOString()
    : expectedRevision;
  if (
    !canonical
    || (expected && canonical.sourceUpdatedAt?.toISOString() !== expected)
  ) return;
  const currentQuarter = canonical.currentQuarter ?? changes.currentQuarter;
  const currentTime = canonical.currentTime ?? changes.currentTime;

  if (changes.scoreChanged) {
    await broadcastScoreUpdate(changes.matchId, {
      matchId: changes.matchId,
      homeScore: canonical.homeScore,
      awayScore: canonical.awayScore,
      currentQuarter,
      currentTime,
    }, access, expectedRevision);
  }

  if (
    changes.statusChanged
    && (canonical.status === 'LIVE' || canonical.status === 'COMPLETED')
  ) {
    const isCompletion = canonical.status === 'COMPLETED';
    await broadcastMatchStatus(changes.matchId, {
      matchId: changes.matchId,
      status: canonical.status,
      quarter: currentQuarter,
      time: isCompletion ? '0' : currentTime,
    }, access, expectedRevision);
    if (isCompletion) {
      await broadcastScoreUpdate(changes.matchId, {
        matchId: changes.matchId,
        homeScore: canonical.homeScore,
        awayScore: canonical.awayScore,
        currentQuarter,
        currentTime: '0',
      }, access, expectedRevision);
    }
  }

  if (matchDetail.playerStats) {
    await broadcastPlayerStats(changes.matchId, matchDetail, access, expectedRevision);
  }

}

// ── Player stats broadcast ──

export async function broadcastPlayerStats(
  matchId: string,
  matchDetail: CDMatchStatsResponse,
  providedAccess?: PublicMatchAccess | null,
  expectedRevision?: Date | string | null,
): Promise<void> {
  if (!matchDetail.playerStats) return;
  const access = await publicAccessForBroadcast(matchId, providedAccess, expectedRevision);
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
    await broadcastStatsUpdate(
      matchId,
      { matchId, playerStats: statsPayload },
      access,
      expectedRevision,
    );
  }
}

/** Emit the persisted player-stat table as a canonical replacement snapshot. */
export async function broadcastCanonicalPlayerStats(
  matchId: string,
  providedAccess?: PublicMatchAccess | null,
  expectedRevision?: Date | string | null,
): Promise<void> {
  const access = await publicAccessForBroadcast(matchId, providedAccess, expectedRevision);
  if (
    !access
    || !isPublicMatchLiveOrFinal(access)
    || !access.features.playerBoxScore.available
  ) return;

  const stats = await prisma.playerMatchStats.findMany({
    where: { matchId },
    orderBy: { playerId: 'asc' },
  });
  await broadcastStatsUpdate(
    matchId,
    {
      matchId,
      playerStats: stats.map((row) => ({
        playerId: row.playerId,
        ...pickStatFields(row),
      })),
    },
    access,
    expectedRevision,
  );
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
  const canonicalPlayerIds = new Set(players.map((player) => player.id));
  const removedPlayerIds = [...oldStatMap.keys()].filter(
    (playerId) => !canonicalPlayerIds.has(playerId),
  );
  if (removedPlayerIds.length > 0) {
    await db.matchEvent.deleteMany({
      where: { matchId, playerId: { in: removedPlayerIds } },
    });
  }

  const eventsToCreate: Array<{
    matchId: string;
    playerId: string;
    type: string;
    period: number;
    periodSeconds: number;
    teamId: string;
  }> = [];
  const eventIdsToDelete: string[] = [];
  const candidatePayloads = new Map<string, Omit<StatEventPayload, 'eventId'>>();

  for (const { stats: ps, isHome } of allPlayerStats) {
    const player = playerMap.get(ps.playerId);
    if (!player) continue;

    const oldStats = oldStatMap.get(player.id) ?? { intercept: 0, deflection: 0, rebound: 0, turnover: 0 };

    for (const { field, type } of STAT_TO_EVENT) {
      const current = (ps[field] ?? 0) as number;
      const previous = oldStats[type];
      const newCount = current - previous;
      if (newCount < 0) {
        const excessEvents = await db.matchEvent.findMany({
          where: {
            matchId,
            playerId: player.id,
            type,
          },
          select: { id: true },
          orderBy: [
            { period: 'desc' },
            { periodSeconds: 'desc' },
            { id: 'desc' },
          ],
          take: Math.abs(newCount),
        });
        eventIdsToDelete.push(...excessEvents.map((event) => event.id));
        continue;
      }
      if (newCount === 0) continue;

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

  if (eventIdsToDelete.length > 0) {
    await db.matchEvent.deleteMany({
      where: { id: { in: eventIdsToDelete } },
    });
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
  expectedRevision?: Date | string | null,
): Promise<void> {
  // The inserted payloads prove the transaction completed, but the socket
  // surface is a replaceable canonical collection so deletions/corrections are
  // reflected too. Do not gate this on `events.length`.
  void events;
  const access = await publicAccessForBroadcast(matchId, undefined, expectedRevision);
  if (!access || !isPublicMatchLiveOrFinal(access) || !access.features.matchEvents.available) return;

  const canonicalEvents = await prisma.matchEvent.findMany({
    where: { matchId },
    include: {
      player: { select: { id: true, name: true } },
      team: { select: { id: true, name: true, abbreviation: true, logoUrl: true } },
      match: { select: { homeTeamId: true } },
    },
    orderBy: [
      { period: 'asc' },
      { periodSeconds: 'asc' },
      { id: 'asc' },
    ],
  });
  const snapshot = canonicalEvents.map((event) => ({
    eventId: event.id,
    matchId,
    type: event.type as StatEventPayload['type'],
    playerId: event.player.id,
    playerName: event.player.name,
    teamId: event.team.id,
    teamName: event.team.name,
    teamAbbreviation: event.team.abbreviation,
    teamLogoUrl: event.team.logoUrl,
    isHomeTeam: event.team.id === event.match.homeTeamId,
    quarter: event.period,
    time: String(event.periodSeconds),
  } satisfies StatEventPayload));

  await broadcastStatEventsSnapshot(
    matchId,
    { matchId, events: snapshot },
    access,
    expectedRevision,
  );
}

// ── Completion broadcast helper ──

export async function broadcastCompletion(
  matchId: string,
  homeScore: number,
  awayScore: number,
  finalQuarter: number,
  expectedRevision?: Date | string | null,
): Promise<void> {
  // Parameters remain for compatibility with existing call sites, but the
  // payload is rebuilt from the canonical committed revision immediately
  // before emit.
  void homeScore;
  void awayScore;
  const access = await publicAccessForBroadcast(matchId, undefined, expectedRevision);
  if (!access || !isPublicMatchLiveOrFinal(access)) return;
  const canonical = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      status: true,
      homeScore: true,
      awayScore: true,
      currentQuarter: true,
      sourceUpdatedAt: true,
    },
  });
  const expected = expectedRevision instanceof Date
    ? expectedRevision.toISOString()
    : expectedRevision;
  if (
    !canonical
    || canonical.status !== 'COMPLETED'
    || (expected && canonical.sourceUpdatedAt?.toISOString() !== expected)
  ) return;
  const canonicalQuarter = canonical.currentQuarter ?? finalQuarter;

  await broadcastMatchStatus(matchId, {
    matchId,
    status: 'COMPLETED',
    quarter: canonicalQuarter,
    time: '0',
  }, access, expectedRevision);
  await broadcastScoreUpdate(matchId, {
    matchId,
    homeScore: canonical.homeScore,
    awayScore: canonical.awayScore,
    currentQuarter: canonicalQuarter,
    currentTime: '0',
  }, access, expectedRevision);
  await broadcastScoreFlowDelta(matchId, access, expectedRevision);
  await broadcastCanonicalPlayerStats(matchId, access, expectedRevision);
  await broadcastPersistedStatEvents(matchId, [], expectedRevision);
}
