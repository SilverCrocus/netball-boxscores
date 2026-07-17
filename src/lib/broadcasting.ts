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
  if (providedAccess !== undefined) return providedAccess;
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

export async function persistAndBroadcastStatEvents(
  matchId: string,
  matchDetail: CDMatchStatsResponse,
  dbMatch: DbMatchWithTeams,
  oldStatMap: Map<string, Record<EventType, number>>,
  period: number,
  periodSeconds: number,
  providedAccess?: PublicMatchAccess | null,
): Promise<void> {
  const access = await publicAccessForBroadcast(matchId, providedAccess);

  const allPlayerStats = [
    ...(matchDetail.playerStats.home ?? []).map((stats) => ({ stats, isHome: true })),
    ...(matchDetail.playerStats.away ?? []).map((stats) => ({ stats, isHome: false })),
  ];

  const players = await prisma.player.findMany({
    where: { championDataPlayerId: { in: allPlayerStats.map(({ stats }) => stats.playerId) } },
    select: { id: true, name: true, championDataPlayerId: true },
  });
  const playerMap = new Map(players.map((p) => [p.championDataPlayerId, p]));

  const eventsToCreate: { matchId: string; playerId: string; type: string; period: number; periodSeconds: number; teamId: string }[] = [];
  const eventsToBroadcast: StatEventPayload[] = [];

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

        eventsToBroadcast.push({
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
        });
      }
    }
  }

  if (eventsToCreate.length > 0) {
    await prisma.matchEvent.createMany({
      data: eventsToCreate,
      skipDuplicates: true,
    });
  }

  if (access && isPublicMatchLiveOrFinal(access) && access.features.matchEvents.available) {
    for (const event of eventsToBroadcast) {
      await broadcastStatEvent(matchId, event, access);
    }
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
