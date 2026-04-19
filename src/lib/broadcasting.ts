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
    broadcastMatchStatus(changes.matchId, {
      matchId: changes.matchId,
      status: changes.newStatus as 'LIVE' | 'COMPLETED',
      quarter: changes.currentQuarter,
      time: changes.currentTime,
    });
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

// ── Intercept events broadcast ──

export async function broadcastInterceptEvents(
  matchId: string,
  matchDetail: CDMatchStatsResponse,
  dbMatch: DbMatchWithTeams,
  oldInterceptMap: Map<string, number>,
  quarter: number,
  time: string,
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

  for (const ps of allPlayerStats) {
    const player = playerMap.get(ps.playerId);
    if (!player) continue;
    const oldIntercepts = oldInterceptMap.get(player.id) ?? 0;
    const newIntercepts = (ps.intercepts ?? 0) - oldIntercepts;
    if (newIntercepts <= 0) continue;

    const isHome = player.teamId === dbMatch.homeTeamId;
    const team = isHome ? dbMatch.homeTeam : dbMatch.awayTeam;

    for (let i = 0; i < newIntercepts; i++) {
      broadcastStatEvent(matchId, {
        matchId,
        type: 'intercept',
        playerId: player.id,
        playerName: player.name,
        teamId: team.id,
        teamName: team.name,
        teamAbbreviation: team.abbreviation,
        teamLogoUrl: team.logoUrl,
        isHomeTeam: isHome,
        quarter,
        time,
      });
    }
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
