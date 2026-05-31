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
import type { ChangeResult } from '@/lib/processing';

// ── Score flow delta tracking ──

const matchScoreFlowCounts = new Map<string, number>();

export function resetScoreFlowTracking(): void {
  matchScoreFlowCounts.clear();
}

export async function broadcastScoreFlowDelta(matchId: string): Promise<void> {
  const allEntries = await prisma.scoreFlow.findMany({
    where: { matchId },
    include: { scorerPlayer: { select: { id: true, name: true } } },
    orderBy: [{ period: 'asc' }, { periodSeconds: 'asc' }],
  });

  const lastCount = matchScoreFlowCounts.get(matchId) ?? 0;
  const newEntries = allEntries.slice(lastCount);
  matchScoreFlowCounts.set(matchId, allEntries.length);

  for (const sf of newEntries) {
    broadcastScoreFlowAdd(matchId, {
      matchId,
      period: sf.period,
      periodSeconds: sf.periodSeconds,
      scoringTeamId: sf.scoringTeamId,
      homeScore: sf.homeScore,
      awayScore: sf.awayScore,
      scorePoints: sf.scorePoints,
      scorerPlayerId: sf.scorerPlayer?.id,
      scorerName: sf.scorerPlayer?.name,
    });
  }
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
  dbMatch: DbMatchWithTeams | null,
): Promise<void> {
  if (!changes.matchId) return;

  if (changes.scoreChanged) {
    broadcastScoreUpdate(changes.matchId, {
      matchId: changes.matchId,
      homeScore: changes.newHomeScore,
      awayScore: changes.newAwayScore,
      currentQuarter: changes.currentQuarter,
      currentTime: changes.currentTime,
    });
  }

  if (changes.statusChanged) {
    const isCompletion = changes.newStatus === 'COMPLETED';
    broadcastMatchStatus(changes.matchId, {
      matchId: changes.matchId,
      status: changes.newStatus as 'LIVE' | 'COMPLETED',
      quarter: changes.currentQuarter,
      time: isCompletion ? '0' : changes.currentTime,
    });
    if (isCompletion) {
      broadcastScoreUpdate(changes.matchId, {
        matchId: changes.matchId,
        homeScore: changes.newHomeScore,
        awayScore: changes.newAwayScore,
        currentQuarter: changes.currentQuarter,
        currentTime: '0',
      });
    }
  }

  if (matchDetail.playerStats) {
    await broadcastPlayerStats(changes.matchId, matchDetail);
  }

  await broadcastScoreFlowDelta(changes.matchId);
}

// ── Player stats broadcast ──

export async function broadcastPlayerStats(
  matchId: string,
  matchDetail: CDMatchStatsResponse,
): Promise<void> {
  if (!matchDetail.playerStats) return;

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
      currentPosition: ps.position ?? '',
      ...pickStatFields(ps),
    }));

  if (statsPayload.length > 0) {
    broadcastStatsUpdate(matchId, { matchId, playerStats: statsPayload });
  }
}

// ── Stat events (intercepts, deflections, rebounds, turnovers) ──

const EVENT_TYPES = ['intercept', 'deflection', 'rebound', 'turnover'] as const;
type EventType = typeof EVENT_TYPES[number];

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
): Promise<void> {
  const allPlayerStats = [
    ...(matchDetail.playerStats.home ?? []),
    ...(matchDetail.playerStats.away ?? []),
  ];

  const players = await prisma.player.findMany({
    where: { championDataPlayerId: { in: allPlayerStats.map((ps) => ps.playerId) } },
    select: { id: true, name: true, championDataPlayerId: true, teamId: true },
  });
  const playerMap = new Map(players.map((p) => [p.championDataPlayerId, p]));

  const eventsToCreate: { matchId: string; playerId: string; type: string; period: number; periodSeconds: number; teamId: string }[] = [];

  for (const ps of allPlayerStats) {
    const player = playerMap.get(ps.playerId);
    if (!player) continue;

    const oldStats = oldStatMap.get(player.id) ?? { intercept: 0, deflection: 0, rebound: 0, turnover: 0 };

    for (const { field, type } of STAT_TO_EVENT) {
      const current = (ps[field] ?? 0) as number;
      const previous = oldStats[type];
      const newCount = current - previous;
      if (newCount <= 0) continue;

      const isHome = player.teamId === dbMatch.homeTeamId;
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

        broadcastStatEvent(matchId, {
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
}

// ── Completion broadcast helper ──

export function broadcastCompletion(
  matchId: string,
  homeScore: number,
  awayScore: number,
  finalQuarter: number,
): void {
  broadcastMatchStatus(matchId, {
    matchId,
    status: 'COMPLETED',
    quarter: finalQuarter,
    time: '0',
  });
  broadcastScoreUpdate(matchId, {
    matchId,
    homeScore,
    awayScore,
    currentQuarter: finalQuarter,
    currentTime: '0',
  });
}
