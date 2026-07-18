import { prisma } from '@/lib/db';
import { mapMatchStatus, fetchMatchStats } from '@/lib/champion-data';
import { pickStatFields, type StatValues } from '@/lib/stat-utils';
import type { MatchStatus, Prisma, ResultQualityStatus } from '@prisma/client';
import type { CDFixtureMatch, CDMatchStatsResponse, CDTeamStats } from '@/types/champion-data';
import { runSerializableTransaction } from '@/lib/serializable-transaction';
import {
  acquireStandingsSourceLock,
  rebuildStandingsInTransaction,
} from '@/lib/standings';

// ── Types ──

interface TeamInfo {
  id: string;
  name: string;
}

interface PlayerInfo {
  id: string;
  name: string;
  teamId: string;
}

interface ExtendedPlayerFields {
  goal2: number;
  attempt2: number;
  netPoints: number;
  points: number;
  goalMisses: number;
  feedWithAttempt: number;
  gain: number;
  pickups: number;
  contactPenalties: number;
  obstructionPenalties: number;
  centrePassToGoalPerc: number;
  quartersPlayed: number;
  blocks: number;
  tossUpWin: number;
  secondPhaseReceive: number;
  possessionChanges: number;
  unforcedTurnovers: number;
  interceptPassThrown: number;
}

export interface ProcessedMatchState {
  cdMatchId: number;
  homeScore: number;
  awayScore: number;
  status: MatchStatus;
  currentQuarter: number;
  currentTime: string;
  quarterScores?: Array<{ quarter: number; homeScore: number; awayScore: number }>;
  playerStats?: Array<StatValues & ExtendedPlayerFields & { championDataPlayerId: number }>;
  teamStats?: {
    home: CDTeamStats;
    away: CDTeamStats;
    homeTeamPrismaId: string;
    awayTeamPrismaId: string;
  };
  scoreFlow?: Array<{
    period: number;
    periodSeconds: number;
    squadId: number;
    scorepoints: number;
    homeScore: number;
    awayScore: number;
    scoringTeamPrismaId: string;
  }>;
}

export interface ValidationResult {
  valid: boolean;
  scoreFlowValid: boolean;
  warnings: string[];
  errors: string[];
  validatedData: ProcessedMatchState | null;
}

export interface ChangeResult {
  matchId: string;
  scoreChanged: boolean;
  statusChanged: boolean;
  timeChanged: boolean;
  newHomeScore: number;
  newAwayScore: number;
  newStatus: MatchStatus;
  currentQuarter: number;
  currentTime: string;
}

const PROMOTABLE_RESULT_QUALITY_VALUES: ResultQualityStatus[] = [
  'UNKNOWN',
  'PROVISIONAL',
  'UNOFFICIAL_FINAL',
];

function hasAcceptedFixtureRevision(
  sourceRetrievedAt: Date | null,
  expectedRevision?: Date,
): boolean {
  return expectedRevision === undefined
    || sourceRetrievedAt?.getTime() === expectedRevision.getTime();
}

/**
 * Keep the local schedule aligned with an upstream Champion Data fixture.
 * Finals are published under a separate upstream competition, but belong to
 * the same CentrePass season and therefore share the regular competition row.
 */
export async function syncFixtureMatches(
  fixtureMatches: CDFixtureMatch[],
  seasonCompetitionId: number,
  sourceCompetitionId: number,
  fixtureObservationAt: Date = new Date(),
): Promise<number> {
  if (fixtureMatches.length === 0) return 0;

  const competition = await prisma.competition.findUnique({
    where: { championDataId: seasonCompetitionId },
    select: {
      id: true,
      stages: {
        where: { slug: { in: ['regular-season', 'finals'] } },
        select: { id: true, slug: true },
      },
    },
  });
  if (!competition) {
    console.warn(`[Processing] Competition ${seasonCompetitionId} not found — fixture sync skipped`);
    return 0;
  }

  const teams = await prisma.team.findMany({
    where: { championDataTeamId: { not: null } },
    select: { id: true, championDataTeamId: true },
  });
  const teamIds = new Map(
    teams.map((team) => [team.championDataTeamId!, team.id]),
  );
  const stageIds = new Map(competition.stages.map((stage) => [stage.slug, stage.id]));
  // Use request start rather than response completion so a slow, older
  // fixture request cannot overwrite metadata from a newer observation.
  const retrievedAt = fixtureObservationAt;

  let syncedMatches = 0;
  for (const fixture of fixtureMatches) {
    const homeTeamId = teamIds.get(fixture.homeSquadId);
    const awayTeamId = teamIds.get(fixture.awaySquadId);
    if (!homeTeamId || !awayTeamId) {
      console.warn(`[Processing] Match ${fixture.matchId} skipped — team mapping missing`);
      continue;
    }

    const isFinals = Boolean(fixture.finalCode) || sourceCompetitionId !== seasonCompetitionId;
    const stageId = stageIds.get(isFinals ? 'finals' : 'regular-season');
    const staticData = {
      competitionId: competition.id,
      homeTeamId,
      awayTeamId,
      round: fixture.roundNumber,
      roundLabel: `Round ${fixture.roundNumber}`,
      venue: fixture.venueName,
      scheduledAt: new Date(fixture.utcStartTime),
      sourceCompetitionId,
      sourceRetrievedAt: retrievedAt,
      finalCode: fixture.finalCode || null,
      ...(stageId ? { stageId } : {}),
    };

    const initialStatus = mapMatchStatus(fixture.matchStatus);

    const accepted = await runSerializableTransaction(async (tx) => {
      const current = await tx.match.findUnique({
        where: { championDataMatchId: fixture.matchId },
        select: {
          id: true,
          competitionId: true,
          homeTeamId: true,
          awayTeamId: true,
          stageId: true,
          finalCode: true,
          status: true,
          resultQuality: true,
          sourceRetrievedAt: true,
        },
      });

      if (!current) {
        const inserted = await tx.match.upsert({
          where: { championDataMatchId: fixture.matchId },
          update: {},
          create: {
            championDataMatchId: fixture.matchId,
            ...staticData,
            status: initialStatus,
            resultQuality:
              initialStatus === 'COMPLETED'
                // A fixture score is not a coherent final detail revision. Keep it
                // non-public/non-standings until finalization applies the matching
                // detail snapshot transactionally.
                ? 'PROVISIONAL'
                : initialStatus === 'LIVE'
                  ? 'PROVISIONAL'
                  : 'UNKNOWN',
            homeScore: fixture.homeSquadScore ?? 0,
            awayScore: fixture.awaySquadScore ?? 0,
          },
          select: { sourceRetrievedAt: true },
        });
        return inserted.sourceRetrievedAt?.getTime() === retrievedAt.getTime();
      }

      if (current.sourceRetrievedAt && current.sourceRetrievedAt >= retrievedAt) {
        return false;
      }

      const standingsMetadataChanged = (
        current.competitionId !== competition.id
        || current.homeTeamId !== homeTeamId
        || current.awayTeamId !== awayTeamId
        || current.stageId !== (stageId ?? null)
        || current.finalCode !== (fixture.finalCode || null)
      ) && current.status === 'COMPLETED'
        && ['UNOFFICIAL_FINAL', 'OFFICIAL_FINAL', 'CORRECTED'].includes(current.resultQuality);
      const affectedCompetitionIds = standingsMetadataChanged
        ? [...new Set([current.competitionId, competition.id])].toSorted()
        : [];
      for (const affectedCompetitionId of affectedCompetitionIds) {
        await acquireStandingsSourceLock(tx, affectedCompetitionId);
      }

      // Compare against the exact revision read above. This serializes fixture
      // metadata with live/final result transactions for the same match.
      const updated = await tx.match.updateMany({
        where: {
          id: current.id,
          sourceRetrievedAt: current.sourceRetrievedAt,
        },
        data: staticData,
      });
      if (updated.count !== 1) return false;

      for (const affectedCompetitionId of affectedCompetitionIds) {
        await rebuildStandingsInTransaction(tx, affectedCompetitionId);
      }
      return true;
    });
    if (accepted) syncedMatches += 1;
  }
  return syncedMatches;
}

// ── Validation ──

const MAX_QUARTER_SECONDS = 960; // 15min (900s) + 60s buffer
const MAX_ET_SECONDS = 360;      // 5min (300s) + 60s buffer

function toTeamStatsData(stats: CDTeamStats, isHome: boolean) {
  return {
    isHome,
    goals: stats.goals,
    goalAttempts: stats.attempts,
    goal2: stats.goal2,
    attempt2: stats.attempt2,
    points: stats.points,
    goalAssists: stats.goalAssists,
    intercepts: stats.intercepts,
    deflections: stats.deflections,
    rebounds: stats.rebounds,
    penalties: stats.penalties,
    contactPenalties: stats.contactPenalties,
    obstructionPenalties: stats.obstructionPenalties,
    feeds: stats.feeds,
    feedWithAttempt: stats.feedWithAttempt,
    centrePassReceives: stats.centrePassReceives,
    turnovers: stats.turnovers,
    gain: stats.gain,
    timeout: stats.timeout,
    timeInPossession: stats.timeInPossession,
    timeToScore: stats.timeToScore,
    goalsFromCentrePass: stats.goalsFromCentrePass,
    goalsFromGain: stats.goalsFromGain,
    centrePassToGoalPerc: stats.centrePassToGoalPerc,
    gainToGoalPerc: stats.gainToGoalPerc,
    possessionChanges: stats.possessionChanges,
    netPoints: stats.netPoints,
    goalMisses: stats.goalMisses,
    blocks: stats.blocks,
    pickups: stats.pickups,
    tossUpWin: stats.tossUpWin,
  };
}

export function validateMatchData(
  fixture: CDFixtureMatch,
  detail: CDMatchStatsResponse,
  dbTeams: Map<number, TeamInfo>,
  dbPlayers: Map<number, PlayerInfo>,
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let valid = true;
  let scoreFlowValid = true;

  // Team validation
  const homeTeam = dbTeams.get(detail.matchInfo.homeSquadId);
  const awayTeam = dbTeams.get(detail.matchInfo.awaySquadId);
  if (!homeTeam) {
    errors.push(`Home team squadId ${detail.matchInfo.homeSquadId} not found in DB`);
    valid = false;
  }
  if (!awayTeam) {
    errors.push(`Away team squadId ${detail.matchInfo.awaySquadId} not found in DB`);
    valid = false;
  }

  // Quarter validation
  const period = detail.matchInfo.period;
  if (period < 1) {
    errors.push(`Invalid period ${period} — must be >= 1`);
    valid = false;
  }

  // Time validation (clamp, don't reject)
  let periodSeconds = detail.matchInfo.periodSeconds;
  if (periodSeconds < 0) {
    warnings.push(`Negative periodSeconds ${periodSeconds} — clamp to 0`);
    periodSeconds = 0;
  }
  const maxSecs = period > 4 ? MAX_ET_SECONDS : MAX_QUARTER_SECONDS;
  if (periodSeconds > maxSecs) {
    warnings.push(`periodSeconds ${periodSeconds} exceeds max ${maxSecs} — clamp`);
    periodSeconds = maxSecs;
  }

  // Status validation
  const status = mapMatchStatus(fixture.matchStatus);

  // Player validation (warning only)
  const allPlayers = [
    ...(detail.playerStats?.home ?? []),
    ...(detail.playerStats?.away ?? []),
  ];
  const unknownPlayerIds: number[] = [];
  for (const p of allPlayers) {
    if (!dbPlayers.has(p.playerId)) {
      unknownPlayerIds.push(p.playerId);
    }
  }
  if (unknownPlayerIds.length > 0) {
    warnings.push(`Unknown player IDs: ${unknownPlayerIds.join(', ')}`);
  }

  // Score flow monotonicity check (warn only — CD corrections can cause brief dips)
  if (detail.scoreFlow && detail.scoreFlow.length > 1) {
    let prevTotal = detail.scoreFlow[0].homeScore + detail.scoreFlow[0].awayScore;
    for (let i = 1; i < detail.scoreFlow.length; i++) {
      const total = detail.scoreFlow[i].homeScore + detail.scoreFlow[i].awayScore;
      if (total < prevTotal) {
        warnings.push(`Non-monotonic score flow at index ${i}: total ${total} < prev ${prevTotal}`);
        scoreFlowValid = false;
        break;
      }
      prevTotal = total;
    }
  }

  if (!valid) {
    return { valid, scoreFlowValid, warnings, errors, validatedData: null };
  }

  // Build validated data
  const validatedData: ProcessedMatchState = {
    cdMatchId: fixture.matchId,
    homeScore: detail.matchInfo.homeScore,
    awayScore: detail.matchInfo.awayScore,
    status,
    currentQuarter: period,
    currentTime: String(periodSeconds),
    quarterScores: detail.periodScores?.map((ps) => ({
      quarter: ps.period,
      homeScore: ps.homeScore,
      awayScore: ps.awayScore,
    })),
    playerStats: detail.playerStats
      ? allPlayers.filter((ps) => dbPlayers.has(ps.playerId)).map((ps) => ({
          championDataPlayerId: ps.playerId,
          ...pickStatFields(ps),
          goal2: ps.goal2,
          attempt2: ps.attempt2,
          netPoints: ps.netPoints,
          points: ps.points,
          goalMisses: ps.goalMisses,
          feedWithAttempt: ps.feedWithAttempt,
          gain: ps.gain,
          pickups: ps.pickups,
          contactPenalties: ps.contactPenalties,
          obstructionPenalties: ps.obstructionPenalties,
          centrePassToGoalPerc: ps.centrePassToGoalPerc,
          quartersPlayed: ps.quartersPlayed,
          blocks: ps.blocks,
          tossUpWin: ps.tossUpWin,
          secondPhaseReceive: ps.secondPhaseReceive,
          possessionChanges: ps.possessionChanges,
          unforcedTurnovers: ps.unforcedTurnovers,
          interceptPassThrown: ps.interceptPassThrown,
        }))
      : undefined,
    teamStats: detail.teamStats && homeTeam && awayTeam ? {
      home: detail.teamStats.home,
      away: detail.teamStats.away,
      homeTeamPrismaId: homeTeam.id,
      awayTeamPrismaId: awayTeam.id,
    } : undefined,
  };

  // Include score flow even if monotonicity check failed (CD corrections are common)
  if (detail.scoreFlow && homeTeam && awayTeam) {
    validatedData.scoreFlow = detail.scoreFlow.map((sf) => ({
      period: sf.period,
      periodSeconds: sf.periodSeconds,
      squadId: sf.squadId,
      scorepoints: sf.scorepoints,
      homeScore: sf.homeScore,
      awayScore: sf.awayScore,
      scoringTeamPrismaId:
        sf.squadId === detail.matchInfo.homeSquadId
          ? homeTeam.id
          : awayTeam.id,
    }));
  }

  return { valid, scoreFlowValid, warnings, errors, validatedData };
}

// ── Change Detection ──

export async function detectChanges(
  incoming: ProcessedMatchState,
): Promise<ChangeResult> {
  const match = await prisma.match.findUnique({
    where: { championDataMatchId: incoming.cdMatchId },
  });
  if (!match) {
    return {
      matchId: '',
      scoreChanged: false,
      statusChanged: false,
      timeChanged: false,
      newHomeScore: incoming.homeScore,
      newAwayScore: incoming.awayScore,
      newStatus: incoming.status,
      currentQuarter: incoming.currentQuarter,
      currentTime: incoming.currentTime,
    };
  }

  return {
    matchId: match.id,
    scoreChanged:
      match.homeScore !== incoming.homeScore ||
      match.awayScore !== incoming.awayScore,
    statusChanged: match.status !== incoming.status,
    timeChanged:
      match.currentQuarter !== incoming.currentQuarter ||
      match.currentTime !== incoming.currentTime,
    newHomeScore: incoming.homeScore,
    newAwayScore: incoming.awayScore,
    newStatus: incoming.status,
    currentQuarter: incoming.currentQuarter,
    currentTime: incoming.currentTime,
  };
}

// ── Apply Changes (write to live tables) ──

type ApplyChangesClient = Pick<
  Prisma.TransactionClient,
  | 'match'
  | 'matchQuarter'
  | 'player'
  | 'playerMatchStats'
  | 'scoreFlow'
  | 'teamMatchStats'
>;

export async function applyChanges(
  changes: ChangeResult,
  incoming: ProcessedMatchState,
  db: ApplyChangesClient = prisma,
): Promise<Map<string, Array<{ playerId: string; name: string }>>> {
  if (!changes.matchId) return new Map();

  if (changes.scoreChanged || changes.statusChanged || changes.timeChanged) {
    await db.match.update({
      where: { id: changes.matchId },
      data: {
        homeScore: changes.newHomeScore,
        awayScore: changes.newAwayScore,
        status: changes.newStatus,
        ...(changes.statusChanged
          ? {
               resultQuality:
                 changes.newStatus === 'COMPLETED'
                   // The live detail write is not yet reconciled against the
                   // final fixture revision. Keep it non-public until
                   // finalizeCompletedMatches replaces the full canonical
                   // detail snapshot and score in one transaction.
                   ? 'PROVISIONAL' as const
                   : changes.newStatus === 'LIVE'
                    ? 'PROVISIONAL' as const
                    : 'UNKNOWN' as const,
            }
          : {}),
        currentQuarter: changes.currentQuarter,
        currentTime: changes.currentTime,
      },
    });
  }

  if (incoming.quarterScores) {
    for (const qs of incoming.quarterScores) {
      await db.matchQuarter.upsert({
        where: { matchId_quarter: { matchId: changes.matchId, quarter: qs.quarter } },
        update: { homeScore: qs.homeScore, awayScore: qs.awayScore },
        create: { matchId: changes.matchId, quarter: qs.quarter, homeScore: qs.homeScore, awayScore: qs.awayScore },
      });
    }
  }

  // Scorer attribution
  const scorersByTeam = new Map<string, Array<{ playerId: string; name: string }>>();

  if (incoming.playerStats) {
    const players = await db.player.findMany({
      where: { championDataPlayerId: { in: incoming.playerStats.map((ps) => ps.championDataPlayerId) } },
      select: { id: true, name: true, championDataPlayerId: true, teamId: true },
    });
    const playerMap = new Map(players.map((p) => [p.championDataPlayerId, p]));

    const oldStats = await db.playerMatchStats.findMany({
      where: { matchId: changes.matchId },
      select: { playerId: true, goals: true },
    });
    const oldGoalMap = new Map(oldStats.map((s) => [s.playerId, s.goals]));
    const canonicalPlayerIds = incoming.playerStats.flatMap((stats) => {
      const player = playerMap.get(stats.championDataPlayerId);
      return player ? [player.id] : [];
    });
    await db.playerMatchStats.deleteMany({
      where: {
        matchId: changes.matchId,
        ...(canonicalPlayerIds.length > 0
          ? { playerId: { notIn: canonicalPlayerIds } }
          : {}),
      },
    });

    const upserts = incoming.playerStats
      .filter((ps) => playerMap.has(ps.championDataPlayerId))
      .map((ps) => {
        const player = playerMap.get(ps.championDataPlayerId)!;
        const statsData = {
          ...pickStatFields(ps),
          goal2: ps.goal2,
          attempt2: ps.attempt2,
          netPoints: ps.netPoints,
          points: ps.points,
          goalMisses: ps.goalMisses,
          feedWithAttempt: ps.feedWithAttempt,
          gain: ps.gain,
          pickups: ps.pickups,
          contactPenalties: ps.contactPenalties,
          obstructionPenalties: ps.obstructionPenalties,
          centrePassToGoalPerc: ps.centrePassToGoalPerc,
          quartersPlayed: ps.quartersPlayed,
          blocks: ps.blocks,
          tossUpWin: ps.tossUpWin,
          secondPhaseReceive: ps.secondPhaseReceive,
          possessionChanges: ps.possessionChanges,
          unforcedTurnovers: ps.unforcedTurnovers,
          interceptPassThrown: ps.interceptPassThrown,
        };
        return db.playerMatchStats.upsert({
          where: { playerId_matchId: { playerId: player.id, matchId: changes.matchId } },
          update: statsData,
          create: { playerId: player.id, matchId: changes.matchId, ...statsData },
        });
      });

    await Promise.all(upserts);

    for (const ps of incoming.playerStats) {
      const player = playerMap.get(ps.championDataPlayerId);
      if (!player) continue;
      const oldGoals = oldGoalMap.get(player.id) ?? 0;
      const newGoals = ps.goals - oldGoals;
      if (newGoals > 0) {
        const queue = scorersByTeam.get(player.teamId) ?? [];
        for (let i = 0; i < newGoals; i++) {
          queue.push({ playerId: player.id, name: player.name });
        }
        scorersByTeam.set(player.teamId, queue);
      }
    }
  }

  if (incoming.teamStats) {
    const teamStats = [
      { teamId: incoming.teamStats.homeTeamPrismaId, stats: incoming.teamStats.home, isHome: true },
      { teamId: incoming.teamStats.awayTeamPrismaId, stats: incoming.teamStats.away, isHome: false },
    ];
    for (const { teamId, stats, isHome } of teamStats) {
      const data = toTeamStatsData(stats, isHome);
      await db.teamMatchStats.upsert({
        where: { matchId_teamId: { matchId: changes.matchId, teamId } },
        update: data,
        create: { matchId: changes.matchId, teamId, ...data },
      });
    }
  }

  if (incoming.scoreFlow) {
    const existing = await db.scoreFlow.findMany({
      where: { matchId: changes.matchId },
      select: {
        period: true,
        periodSeconds: true,
        scoringTeamId: true,
        homeScore: true,
        awayScore: true,
        scorePoints: true,
      },
    });
    const existingByKey = new Map(
      existing.map((sf) => [`${sf.period}-${sf.periodSeconds}-${sf.scoringTeamId}`, sf]),
    );
    const scorerIdx = new Map<string, number>();
    const incomingKeys = new Set<string>();

    for (const sf of incoming.scoreFlow) {
      const key = `${sf.period}-${sf.periodSeconds}-${sf.scoringTeamPrismaId}`;
      incomingKeys.add(key);
      const existingScore = existingByKey.get(key);
      const isNew = !existingScore;
      let scorerPlayerId: string | undefined;
      if (isNew) {
        const queue = scorersByTeam.get(sf.scoringTeamPrismaId);
        if (queue) {
          const idx = scorerIdx.get(sf.scoringTeamPrismaId) ?? 0;
          if (idx < queue.length) {
            scorerPlayerId = queue[idx].playerId;
            scorerIdx.set(sf.scoringTeamPrismaId, idx + 1);
          }
        }
      }

      if (
        existingScore
        && existingScore.homeScore === sf.homeScore
        && existingScore.awayScore === sf.awayScore
        && existingScore.scorePoints === sf.scorepoints
      ) {
        continue;
      }

      await db.scoreFlow.upsert({
        where: { matchId_period_periodSeconds_scoringTeamId: { matchId: changes.matchId, period: sf.period, periodSeconds: sf.periodSeconds, scoringTeamId: sf.scoringTeamPrismaId } },
        update: {
          homeScore: sf.homeScore,
          awayScore: sf.awayScore,
          scorePoints: sf.scorepoints,
        },
        create: {
          matchId: changes.matchId,
          period: sf.period,
          periodSeconds: sf.periodSeconds,
          scoringTeamId: sf.scoringTeamPrismaId,
          homeScore: sf.homeScore,
          awayScore: sf.awayScore,
          scorePoints: sf.scorepoints,
          scorerPlayerId: scorerPlayerId ?? null,
        },
      });
      existingByKey.set(key, {
        period: sf.period,
        periodSeconds: sf.periodSeconds,
        scoringTeamId: sf.scoringTeamPrismaId,
        homeScore: sf.homeScore,
        awayScore: sf.awayScore,
        scorePoints: sf.scorepoints,
      });
    }

    const removedEntries = existing.filter((score) => !incomingKeys.has(
      `${score.period}-${score.periodSeconds}-${score.scoringTeamId}`,
    ));
    if (removedEntries.length > 0) {
      await db.scoreFlow.deleteMany({
        where: {
          matchId: changes.matchId,
          OR: removedEntries.map((score) => ({
            period: score.period,
            periodSeconds: score.periodSeconds,
            scoringTeamId: score.scoringTeamId,
          })),
        },
      });
    }
  }

  return scorersByTeam;
}

// ── Write final stats helper (shared by applyChanges and finalizeCompletedMatches) ──

type FinalStatsClient = Pick<
  Prisma.TransactionClient,
  | 'match'
  | 'matchQuarter'
  | 'player'
  | 'playerMatchStats'
  | 'matchEvent'
  | 'scoreFlow'
  | 'teamMatchStats'
>;

export async function writeFinalStats(
  matchId: string,
  detail: CDMatchStatsResponse,
  db: FinalStatsClient = prisma,
): Promise<void> {
  const allPlayers = [
    ...(detail.playerStats?.home ?? []),
    ...(detail.playerStats?.away ?? []),
  ];

  // Final detail is a canonical snapshot. Remove rows absent from the same
  // revision before upserting its current values.
  if (detail.periodScores) {
    await db.matchQuarter.deleteMany({
      where: {
        matchId,
        quarter: { notIn: detail.periodScores.map((score) => score.period) },
      },
    });
    for (const ps of detail.periodScores) {
      await db.matchQuarter.upsert({
        where: { matchId_quarter: { matchId, quarter: ps.period } },
        update: { homeScore: ps.homeScore, awayScore: ps.awayScore },
        create: { matchId, quarter: ps.period, homeScore: ps.homeScore, awayScore: ps.awayScore },
      });
    }
  }

  // Player stats
  if (detail.playerStats) {
    const players = await db.player.findMany({
      where: { championDataPlayerId: { in: allPlayers.map((p) => p.playerId) } },
      select: { id: true, championDataPlayerId: true, teamId: true },
    });
    const playerMap = new Map(players.map((p) => [p.championDataPlayerId, p]));
    const canonicalPlayerIds = allPlayers.flatMap((stats) => {
      const player = playerMap.get(stats.playerId);
      return player ? [player.id] : [];
    });
    const canonicalEventCounts = new Map<string, number>();
    for (const stats of allPlayers) {
      const player = playerMap.get(stats.playerId);
      if (!player) continue;
      canonicalEventCounts.set(`${player.id}\u0000intercept`, stats.intercepts ?? 0);
      canonicalEventCounts.set(`${player.id}\u0000deflection`, stats.deflections ?? 0);
      canonicalEventCounts.set(`${player.id}\u0000rebound`, stats.rebounds ?? 0);
      canonicalEventCounts.set(`${player.id}\u0000turnover`, stats.turnovers ?? 0);
    }
    const existingEvents = await db.matchEvent.findMany({
      where: {
        matchId,
        type: { in: ['intercept', 'deflection', 'rebound', 'turnover'] },
      },
      select: { id: true, playerId: true, type: true },
      orderBy: [
        { period: 'desc' },
        { periodSeconds: 'desc' },
        { id: 'desc' },
      ],
    });
    const eventsByStat = new Map<string, string[]>();
    for (const event of existingEvents) {
      const key = `${event.playerId}\u0000${event.type}`;
      const ids = eventsByStat.get(key) ?? [];
      ids.push(event.id);
      eventsByStat.set(key, ids);
    }
    const eventIdsToDelete = [...eventsByStat].flatMap(([key, ids]) => (
      ids.slice(0, Math.max(0, ids.length - (canonicalEventCounts.get(key) ?? 0)))
    ));
    if (eventIdsToDelete.length > 0) {
      await db.matchEvent.deleteMany({ where: { id: { in: eventIdsToDelete } } });
    }
    await db.playerMatchStats.deleteMany({
      where: {
        matchId,
        ...(canonicalPlayerIds.length > 0
          ? { playerId: { notIn: canonicalPlayerIds } }
          : {}),
      },
    });

    const upserts = allPlayers
      .filter((ps) => playerMap.has(ps.playerId))
      .map((ps) => {
        const player = playerMap.get(ps.playerId)!;
        const statsData = {
          ...pickStatFields(ps),
          goal2: ps.goal2,
          attempt2: ps.attempt2,
          netPoints: ps.netPoints,
          points: ps.points,
          goalMisses: ps.goalMisses,
          feedWithAttempt: ps.feedWithAttempt,
          gain: ps.gain,
          pickups: ps.pickups,
          contactPenalties: ps.contactPenalties,
          obstructionPenalties: ps.obstructionPenalties,
          centrePassToGoalPerc: ps.centrePassToGoalPerc,
          quartersPlayed: ps.quartersPlayed,
          blocks: ps.blocks,
          tossUpWin: ps.tossUpWin,
          secondPhaseReceive: ps.secondPhaseReceive,
          possessionChanges: ps.possessionChanges,
          unforcedTurnovers: ps.unforcedTurnovers,
          interceptPassThrown: ps.interceptPassThrown,
        };
        return db.playerMatchStats.upsert({
          where: { playerId_matchId: { playerId: player.id, matchId } },
          update: statsData,
          create: { playerId: player.id, matchId, ...statsData },
        });
      });

    await Promise.all(upserts);
  }

  // Score flow
  if (detail.scoreFlow) {
    const match = await db.match.findUnique({
      where: { id: matchId },
      include: { homeTeam: { select: { championDataTeamId: true, id: true } }, awayTeam: { select: { championDataTeamId: true, id: true } } },
    });
    if (!match || !match.homeTeam || !match.awayTeam) {
      throw new Error(`Cannot persist final score flow for ${matchId}: match teams are unresolved`);
    }

    await db.scoreFlow.deleteMany({ where: { matchId } });

    for (const sf of detail.scoreFlow) {
      const scoringTeamPrismaId =
        sf.squadId === match.homeTeam.championDataTeamId
          ? match.homeTeam.id
          : match.awayTeam.id;

      await db.scoreFlow.create({
        data: {
          matchId,
          period: sf.period,
          periodSeconds: sf.periodSeconds,
          scoringTeamId: scoringTeamPrismaId,
          homeScore: sf.homeScore,
          awayScore: sf.awayScore,
          scorePoints: sf.scorepoints,
          scorerPlayerId: null,
        },
      });
    }
  }

  // Team match stats
  if (detail.teamStats) {
    const match = await db.match.findUnique({
      where: { id: matchId },
      include: { homeTeam: { select: { id: true, championDataTeamId: true } }, awayTeam: { select: { id: true, championDataTeamId: true } } },
    });
    if (!match?.homeTeam || !match.awayTeam) {
      throw new Error(`Cannot persist final team stats for ${matchId}: match teams are unresolved`);
    }
    await db.teamMatchStats.deleteMany({
      where: {
        matchId,
        teamId: { notIn: [match.homeTeam.id, match.awayTeam.id] },
      },
    });
    for (const [side, ts] of [['home', detail.teamStats.home], ['away', detail.teamStats.away]] as const) {
      const teamId = side === 'home' ? match.homeTeam.id : match.awayTeam.id;
      const data = toTeamStatsData(ts, side === 'home');
      await db.teamMatchStats.upsert({
        where: { matchId_teamId: { matchId, teamId } },
        update: data,
        create: { matchId, teamId, ...data },
      });
    }
  }
}

// ── Reconciliation (from match-sync.ts) ──

export interface CompletionCandidate {
  matchId: string;
  homeScore: number;
  awayScore: number;
  finalQuarter: number;
  wasCorrection?: boolean;
}

export interface FinalizedMatch extends CompletionCandidate {
  sourceUpdatedAt: Date;
  standingsChanged: boolean;
}

export interface FinalizationResult {
  matches: FinalizedMatch[];
  failedMatchIds: string[];
}

export async function reconcileCompletedMatches(
  fixtureMatches: CDFixtureMatch[],
  fixtureObservationByMatchId: ReadonlyMap<number, Date> = new Map(),
): Promise<CompletionCandidate[]> {
  const unresolvedMatches = await prisma.match.findMany({
    where: { status: { in: ['LIVE', 'SCHEDULED'] } },
    select: {
      id: true,
      status: true,
      championDataMatchId: true,
      homeScore: true,
      awayScore: true,
      sourceRetrievedAt: true,
      sourceUpdatedAt: true,
    },
  });
  if (unresolvedMatches.length === 0) return [];

  const fixtureMap = new Map(fixtureMatches.map((fm) => [fm.matchId, fm]));
  const completed: CompletionCandidate[] = [];

  for (const dbMatch of unresolvedMatches) {
    if (!dbMatch.championDataMatchId) continue;
    const fixture = fixtureMap.get(dbMatch.championDataMatchId);
    if (!fixture || fixture.matchStatus.toLowerCase() !== 'complete') continue;
    const fixtureObservationAt = fixtureObservationByMatchId.get(fixture.matchId);
    if (!hasAcceptedFixtureRevision(dbMatch.sourceRetrievedAt, fixtureObservationAt)) continue;
    if (
      fixtureObservationAt
      && dbMatch.sourceUpdatedAt
      && dbMatch.sourceUpdatedAt >= fixtureObservationAt
    ) continue;

    const candidate = await runSerializableTransaction(async (tx) => {
      const current = await tx.match.findUnique({
        where: { id: dbMatch.id },
        select: {
          status: true,
          homeScore: true,
          awayScore: true,
          currentQuarter: true,
          sourceRetrievedAt: true,
          sourceUpdatedAt: true,
        },
      });
      if (!current || !['LIVE', 'SCHEDULED'].includes(current.status)) return null;
      if (!hasAcceptedFixtureRevision(current.sourceRetrievedAt, fixtureObservationAt)) return null;
      if (
        fixtureObservationAt
        && current.sourceUpdatedAt
        && current.sourceUpdatedAt >= fixtureObservationAt
      ) return null;

      const updated = await tx.match.updateMany({
        where: {
          id: dbMatch.id,
          status: { in: ['LIVE', 'SCHEDULED'] },
          ...(fixtureObservationAt
            ? {
                sourceRetrievedAt: fixtureObservationAt,
                AND: [{
                  OR: [
                    { sourceUpdatedAt: null },
                    { sourceUpdatedAt: { lt: fixtureObservationAt } },
                  ],
                }],
              }
            : {}),
        },
        data: {
          status: 'COMPLETED',
          // Durable pending-finalization marker. The matching score/detail
          // revision promotes this to OFFICIAL_FINAL in one transaction.
          resultQuality: 'PROVISIONAL',
        },
      });
      if (updated.count === 0) return null;
      return {
        matchId: dbMatch.id,
        homeScore: current.homeScore,
        awayScore: current.awayScore,
        finalQuarter:
          fixture.periodCompleted
          || fixture.period
          || current.currentQuarter
          || 4,
      } satisfies CompletionCandidate;
    });
    if (candidate) completed.push(candidate);
  }

  return completed;
}

/**
 * Identify completed matches whose fixture score or result quality still
 * needs a coherent final detail revision. An already-public result remains the
 * canonical revision while a correction is fetched; score, detail, quality,
 * and standings then switch atomically when the correction succeeds.
 */
export async function reconcileStaleCompletedScores(
  fixtureMatches: CDFixtureMatch[],
  fixtureObservationByMatchId: ReadonlyMap<number, Date> = new Map(),
): Promise<CompletionCandidate[]> {
  const completedMatches = await prisma.match.findMany({
    where: { status: 'COMPLETED', championDataMatchId: { not: null } },
    select: {
      id: true,
      championDataMatchId: true,
      homeScore: true,
      awayScore: true,
      resultQuality: true,
      currentQuarter: true,
      competitionId: true,
      sourceRetrievedAt: true,
      sourceUpdatedAt: true,
    },
  });
  if (completedMatches.length === 0) return [];

  const fixtureMap = new Map(fixtureMatches.map((fm) => [fm.matchId, fm]));
  const pending: CompletionCandidate[] = [];

  for (const dbMatch of completedMatches) {
    const fixture = fixtureMap.get(dbMatch.championDataMatchId!);
    if (!fixture || fixture.matchStatus.toLowerCase() !== 'complete') continue;
    const fixtureObservationAt = fixtureObservationByMatchId.get(fixture.matchId);
    if (!hasAcceptedFixtureRevision(dbMatch.sourceRetrievedAt, fixtureObservationAt)) continue;
    if (
      fixtureObservationAt
      && dbMatch.sourceUpdatedAt
      && dbMatch.sourceUpdatedAt >= fixtureObservationAt
    ) continue;

    const { homeSquadScore, awaySquadScore } = fixture;
    const scoresChanged = dbMatch.homeScore !== homeSquadScore
      || dbMatch.awayScore !== awaySquadScore;
    const qualityNeedsPromotion = PROMOTABLE_RESULT_QUALITY_VALUES.includes(
      dbMatch.resultQuality,
    );
    if (!scoresChanged && !qualityNeedsPromotion) continue;

    const wasCorrection = scoresChanged
      && ['OFFICIAL_FINAL', 'CORRECTED'].includes(dbMatch.resultQuality);
    if (wasCorrection) {
      console.log(
        `[Processing] Final detail correction pending for ${dbMatch.id}: ` +
          `${dbMatch.homeScore}-${dbMatch.awayScore} → ${homeSquadScore}-${awaySquadScore}`,
      );
    }
    pending.push({
      matchId: dbMatch.id,
      homeScore: homeSquadScore,
      awayScore: awaySquadScore,
      finalQuarter: fixture.periodCompleted || fixture.period || dbMatch.currentQuarter || 4,
      wasCorrection,
    });
  }

  return pending;
}

// ── Stale match detection (from worker.ts) ──

export async function detectStaleCompletedMatches(): Promise<
  CompletionCandidate[]
> {
  const liveMatches = await prisma.match.findMany({ where: { status: 'LIVE' } });
  const completed: Array<{ matchId: string; homeScore: number; awayScore: number; finalQuarter: number }> = [];
  const now = Date.now();

  for (const match of liveMatches) {
    const quarter = match.currentQuarter ?? 0;
    if (quarter < 4) continue;
    const elapsed = Number(match.currentTime);
    if (isNaN(elapsed)) continue;

    const quarterLength = quarter > 4 ? 300 : 900;
    const remaining = quarterLength - elapsed;
    const sinceUpdate = now - match.updatedAt.getTime();

    if (remaining < 120 && sinceUpdate >= 60_000) {
      console.log(`[Processing] Match ended (stale clock <2min remaining, no update for 60s): ${match.id}`);
      const updated = await runSerializableTransaction(async (tx) => {
        await acquireStandingsSourceLock(tx, match.competitionId);
        const result = await tx.match.updateMany({
          where: { id: match.id, status: 'LIVE', updatedAt: match.updatedAt },
          data: { status: 'COMPLETED', resultQuality: 'UNOFFICIAL_FINAL' },
        });
        if (result.count > 0) {
          await rebuildStandingsInTransaction(tx, match.competitionId);
        }
        return result;
      });
      if (updated.count === 0) continue;
      completed.push({ matchId: match.id, homeScore: match.homeScore, awayScore: match.awayScore, finalQuarter: quarter });
      continue;
    }

    if (elapsed >= quarterLength) {
      const matchAge = now - match.scheduledAt.getTime();
      if (matchAge >= 90 * 60 * 1000) {
        console.log(`[Processing] Stale LIVE match: ${match.id}`);
        const updated = await runSerializableTransaction(async (tx) => {
          await acquireStandingsSourceLock(tx, match.competitionId);
          const result = await tx.match.updateMany({
            where: { id: match.id, status: 'LIVE', updatedAt: match.updatedAt },
            data: { status: 'COMPLETED', resultQuality: 'UNOFFICIAL_FINAL' },
          });
          if (result.count > 0) {
            await rebuildStandingsInTransaction(tx, match.competitionId);
          }
          return result;
        });
        if (updated.count === 0) continue;
        completed.push({ matchId: match.id, homeScore: match.homeScore, awayScore: match.awayScore, finalQuarter: quarter });
      }
    }
  }

  return completed;
}

// ── Post-completion finalization ──

export async function finalizeCompletedMatches(
  fixtureMatches: CDFixtureMatch[],
  competitionId: number,
  newlyCompletedIds: string[],
  correctionIds: readonly string[] = [],
  fixtureObservationByMatchId: ReadonlyMap<number, Date> = new Map(),
): Promise<FinalizationResult> {
  if (newlyCompletedIds.length === 0) return { matches: [], failedMatchIds: [] };

  const fixtureMap = new Map(fixtureMatches.map((fm) => [fm.matchId, fm]));
  const correctionIdSet = new Set(correctionIds);
  const finalized: FinalizedMatch[] = [];
  const failedMatchIds: string[] = [];

  const matches = await prisma.match.findMany({
    where: { id: { in: newlyCompletedIds }, championDataMatchId: { not: null } },
    select: {
      id: true,
      championDataMatchId: true,
      sourceCompetitionId: true,
      homeScore: true,
      awayScore: true,
      currentQuarter: true,
      resultQuality: true,
      competitionId: true,
      status: true,
      sourceRetrievedAt: true,
      sourceUpdatedAt: true,
    },
  });
  const durableCorrectionLogs = matches.length > 0
    ? await prisma.pollLog.findMany({
        where: {
          cdMatchId: { in: matches.map((match) => match.championDataMatchId!) },
          endpoint: 'final-detail-correction',
          status: { in: ['pending', 'fetch_error', 'revision_mismatch'] },
        },
        select: { cdMatchId: true },
      })
    : [];
  const durableCorrectionMatchIds = new Set(
    durableCorrectionLogs.flatMap((log) => (
      log.cdMatchId === null ? [] : [log.cdMatchId]
    )),
  );

  for (const match of matches) {
    const fixture = fixtureMap.get(match.championDataMatchId!);
    if (!fixture || mapMatchStatus(fixture.matchStatus) !== 'COMPLETED') {
      failedMatchIds.push(match.id);
      continue;
    }
    const fixtureObservationAt = fixtureObservationByMatchId.get(fixture.matchId);
    if (!hasAcceptedFixtureRevision(match.sourceRetrievedAt, fixtureObservationAt)) {
      failedMatchIds.push(match.id);
      continue;
    }
    if (
      fixtureObservationAt
      && match.sourceUpdatedAt
      && match.sourceUpdatedAt >= fixtureObservationAt
    ) {
      failedMatchIds.push(match.id);
      continue;
    }

    const fixtureFinalQuarter = fixture.periodCompleted || fixture.period || 4;
    const detailObservationAt = new Date();
    const correctionAttempt = correctionIdSet.has(match.id)
      || durableCorrectionMatchIds.has(match.championDataMatchId!)
      || match.resultQuality === 'CORRECTED';
    let finalDetailPollLogId: string | null = null;
    try {
      const finalDetailPollLog = await prisma.pollLog.create({
        data: {
          competitionId: match.sourceCompetitionId ?? competitionId,
          cdMatchId: match.championDataMatchId!,
          polledAt: detailObservationAt,
          endpoint: correctionAttempt ? 'final-detail-correction' : 'final-detail',
          rawResponse: {
            fixtureSourceRetrievedAt:
              fixtureObservationAt?.toISOString()
              ?? match.sourceRetrievedAt?.toISOString()
              ?? null,
            fixtureHomeScore: fixture.homeSquadScore,
            fixtureAwayScore: fixture.awaySquadScore,
            previousHomeScore: match.homeScore,
            previousAwayScore: match.awayScore,
          },
          status: 'pending',
        },
      });
      finalDetailPollLogId = finalDetailPollLog.id;
      const detail = await fetchMatchStats(
        match.sourceCompetitionId ?? competitionId,
        match.championDataMatchId!,
      );
      if (
        detail.matchInfo.matchId !== match.championDataMatchId
        || mapMatchStatus(detail.matchInfo.matchStatus) !== 'COMPLETED'
        || detail.matchInfo.homeSquadId !== fixture.homeSquadId
        || detail.matchInfo.awaySquadId !== fixture.awaySquadId
        || detail.matchInfo.homeScore !== fixture.homeSquadScore
        || detail.matchInfo.awayScore !== fixture.awaySquadScore
      ) {
        console.warn(`[Processing] Final detail/fixture revision mismatch for ${match.id}`);
        await prisma.pollLog.update({
          where: { id: finalDetailPollLogId },
          data: {
            status: 'revision_mismatch',
            errorMessage: 'Final detail did not match the accepted fixture revision',
          },
        });
        failedMatchIds.push(match.id);
        continue;
      }

      const transactionFinal = await runSerializableTransaction(async (tx) => {
        const effectiveMatch = await tx.match.findUnique({
          where: { id: match.id },
          select: {
            competitionId: true,
            status: true,
            resultQuality: true,
            homeScore: true,
            awayScore: true,
            currentQuarter: true,
            sourceRetrievedAt: true,
            sourceUpdatedAt: true,
          },
        });
        if (!effectiveMatch) return null;

        if (!hasAcceptedFixtureRevision(
          effectiveMatch.sourceRetrievedAt,
          fixtureObservationAt,
        )) return null;

        if (
          fixtureObservationAt
          && effectiveMatch.sourceUpdatedAt
          && effectiveMatch.sourceUpdatedAt >= fixtureObservationAt
        ) return null;

        if (
          effectiveMatch.sourceUpdatedAt !== null
          && effectiveMatch.sourceUpdatedAt >= detailObservationAt
        ) {
          if (
            effectiveMatch.status === 'COMPLETED'
            && ['OFFICIAL_FINAL', 'CORRECTED'].includes(effectiveMatch.resultQuality)
          ) {
            return {
              matchId: match.id,
              homeScore: effectiveMatch.homeScore,
              awayScore: effectiveMatch.awayScore,
              finalQuarter: effectiveMatch.currentQuarter ?? fixtureFinalQuarter,
              sourceUpdatedAt: effectiveMatch.sourceUpdatedAt,
              standingsChanged: false,
            } satisfies FinalizedMatch;
          }
          return null;
        }

        await acquireStandingsSourceLock(tx, effectiveMatch.competitionId);
        await writeFinalStats(match.id, detail, tx);
        const scoreChanged = effectiveMatch.homeScore !== detail.matchInfo.homeScore
          || effectiveMatch.awayScore !== detail.matchInfo.awayScore;
        const qualityUpdate = correctionAttempt
          ? { resultQuality: 'CORRECTED' as const }
          : { resultQuality: 'OFFICIAL_FINAL' as const };
        const targetQuality = qualityUpdate.resultQuality;
        const qualityChanged = effectiveMatch.resultQuality !== targetQuality;
        const statusChanged = effectiveMatch.status !== 'COMPLETED';
        const finalQuarter = detail.matchInfo.period || fixtureFinalQuarter;

        await tx.match.update({
          where: {
            id: match.id,
            ...(fixtureObservationAt ? { sourceRetrievedAt: fixtureObservationAt } : {}),
            OR: [
              { sourceUpdatedAt: null },
              { sourceUpdatedAt: { lt: detailObservationAt } },
            ],
          },
          data: {
            status: 'COMPLETED',
            ...qualityUpdate,
            homeScore: detail.matchInfo.homeScore,
            awayScore: detail.matchInfo.awayScore,
            currentQuarter: finalQuarter,
            currentTime: String(detail.matchInfo.periodSeconds ?? 0),
            sourceUpdatedAt: detailObservationAt,
          },
        });
        await rebuildStandingsInTransaction(tx, effectiveMatch.competitionId);

        return {
          matchId: match.id,
          homeScore: detail.matchInfo.homeScore,
          awayScore: detail.matchInfo.awayScore,
          finalQuarter,
          sourceUpdatedAt: detailObservationAt,
          standingsChanged: scoreChanged || qualityChanged || statusChanged,
        } satisfies FinalizedMatch;
      });
      await prisma.pollLog.update({
        where: { id: finalDetailPollLogId },
        data: { status: transactionFinal ? 'processed' : 'superseded' },
      });
      if (transactionFinal) {
        if (correctionAttempt) {
          await prisma.pollLog.updateMany({
            where: {
              cdMatchId: match.championDataMatchId!,
              endpoint: 'final-detail-correction',
              status: { in: ['pending', 'fetch_error', 'revision_mismatch'] },
            },
            data: { status: 'superseded' },
          });
        }
        finalized.push(transactionFinal);
      }
    } catch (error) {
      console.error(`[Processing] Failed to finalize ${match.id}:`, error);
      if (finalDetailPollLogId) {
        await prisma.pollLog.update({
          where: { id: finalDetailPollLogId },
          data: {
            status: 'fetch_error',
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        }).catch(() => undefined);
      }
      failedMatchIds.push(match.id);
    }
  }

  return { matches: finalized, failedMatchIds };
}
