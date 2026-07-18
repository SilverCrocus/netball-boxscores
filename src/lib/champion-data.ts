import type {
  CDFixtureResponse,
  CDFixtureMatch,
  CDMatchStatsResponse,
  CDPlayerStats,
  CDScoreFlowEntry,
  CDPeriodScore,
  CDTeamStats,
  CDRawMatchStatsResponse,
  CDRawTeamStats,
  CDRawPlayerStats,
  CDRawScoreFlowEntry,
} from "@/types/champion-data";
import { pickStatFields, type StatValues } from "@/lib/stat-utils";
import { fetchJsonWithinLimits } from '@/lib/bounded-fetch';

type MatchStatus = "SCHEDULED" | "LIVE" | "COMPLETED";

const SIM_MODE = process.env.SIMULATION_MODE === 'true' && process.env.NODE_ENV !== 'production';
const SIM_BASE = `http://localhost:${process.env.PORT || 3000}/api/sim`;
const CD_BASE =
  process.env.CHAMPION_DATA_BASE_URL || 'https://mc.championdata.com/data';
const CHAMPION_DATA_TIMEOUT_MS = 10_000;
const CHAMPION_DATA_MAX_BYTES = 5 * 1024 * 1024;

async function fetchFromChampionData<T>(path: string): Promise<T> {
  const baseUrl = SIM_MODE ? SIM_BASE : CD_BASE;
  const url = `${baseUrl}${path}`;
  return fetchJsonWithinLimits<T>({
    url,
    label: 'Champion Data API',
    timeoutMs: CHAMPION_DATA_TIMEOUT_MS,
    maxBytes: CHAMPION_DATA_MAX_BYTES,
    init: { cache: 'no-store' },
  });
}

/**
 * Fetch fixture (schedule + results) for a competition.
 * Returns the array of matches from the nested fixture.match structure.
 */
export async function fetchFixture(compId: number): Promise<CDFixtureMatch[]> {
  // In sim mode, skip compId — sim routes serve at /api/sim/fixture.json
  const path = SIM_MODE ? '/fixture.json' : `/${compId}/fixture.json`;
  const data = await fetchFromChampionData<CDFixtureResponse>(path);
  return data.fixture?.match ?? [];
}

/**
 * Transform a raw Champion Data team stats entry to the normalised shape.
 * CD uses `goalAttempts` and `generalPlayTurnovers` instead of `attempts`/`turnovers`.
 */
function mapRawTeamStats(t: CDRawTeamStats | undefined): CDTeamStats {
  return {
    squadId: t?.squadId ?? 0,
    goals: t?.goals ?? 0,
    attempts: t?.goalAttempts ?? 0,
    goal2: t?.goal2 ?? 0,
    attempt2: t?.attempt2 ?? 0,
    points: t?.points ?? 0,
    goalAssists: t?.goalAssists ?? 0,
    intercepts: t?.intercepts ?? 0,
    deflections: t?.deflections ?? 0,
    rebounds: t?.rebounds ?? 0,
    penalties: t?.penalties ?? 0,
    contactPenalties: t?.contactPenalties ?? 0,
    obstructionPenalties: t?.obstructionPenalties ?? 0,
    feeds: t?.feeds ?? 0,
    feedWithAttempt: t?.feedWithAttempt ?? 0,
    centrePassReceives: t?.centrePassReceives ?? 0,
    turnovers: t?.generalPlayTurnovers ?? 0,
    gain: t?.gain ?? 0,
    timeout: t?.timeout ?? 0,
    timeInPossession: t?.timeInPossession ?? 0,
    timeToScore: t?.timeToScore ?? 0,
    goalsFromCentrePass: t?.goalsFromCentrePass ?? 0,
    goalsFromGain: t?.goalsFromGain ?? 0,
    centrePassToGoalPerc: t?.centrePassToGoalPerc ?? 0,
    gainToGoalPerc: t?.gainToGoalPerc ?? 0,
    possessionChanges: t?.possessionChanges ?? 0,
    netPoints: t?.netPoints ?? 0,
    goalMisses: t?.goalMisses ?? 0,
    blocks: t?.blocks ?? 0,
    pickups: t?.pickups ?? 0,
    tossUpWin: t?.tossUpWin ?? 0,
  };
}

/**
 * Transform a raw Champion Data player stats entry to the normalised shape.
 */
function mapRawPlayer(p: CDRawPlayerStats): CDPlayerStats {
  return {
    playerId: p.playerId,
    displayName: p.displayName ?? '',
    position: p.currentPositionCode ?? p.startingPositionCode ?? '',
    squadId: p.squadId,
    goals: p.goals ?? 0,
    attempts: p.goalAttempts ?? 0,
    goal2: p.goal2 ?? 0,
    attempt2: p.attempt2 ?? 0,
    netPoints: p.netPoints ?? 0,
    points: p.points ?? 0,
    goalAssists: p.goalAssists ?? 0,
    intercepts: p.intercepts ?? 0,
    deflections: p.deflections ?? 0,
    rebounds: p.rebounds ?? 0,
    penalties: p.penalties ?? 0,
    contactPenalties: p.contactPenalties ?? 0,
    obstructionPenalties: p.obstructionPenalties ?? 0,
    feeds: p.feeds ?? 0,
    feedWithAttempt: p.feedWithAttempt ?? 0,
    centrePassReceives: p.centrePassReceives ?? 0,
    turnovers: p.generalPlayTurnovers ?? 0,
    minutesPlayed: p.minutesPlayed ?? 0,
    goalMisses: p.goalMisses ?? 0,
    gain: p.gain ?? 0,
    pickups: p.pickups ?? 0,
    centrePassToGoalPerc: p.centrePassToGoalPerc ?? 0,
    quartersPlayed: p.quartersPlayed ?? 0,
    blocks: p.blocks ?? 0,
    tossUpWin: p.tossUpWin ?? 0,
    secondPhaseReceive: p.secondPhaseReceive ?? 0,
    possessionChanges: p.possessionChanges ?? 0,
    unforcedTurnovers: p.unforcedTurnovers ?? 0,
    interceptPassThrown: p.interceptPassThrown ?? 0,
  };
}

/**
 * Build score flow with running totals from raw score entries.
 */
function buildScoreFlow(
  rawScores: CDRawScoreFlowEntry[],
  homeSquadId: number
): CDScoreFlowEntry[] {
  const sorted = [...rawScores].sort(
    (a, b) => a.period - b.period || a.periodSeconds - b.periodSeconds
  );
  let runHome = 0;
  let runAway = 0;
  return sorted
    .filter((s) => s.scorepoints > 0)
    .map((s) => {
      if (s.squadId === homeSquadId) runHome += s.scorepoints;
      else runAway += s.scorepoints;
      return {
        period: s.period,
        periodSeconds: s.periodSeconds,
        squadId: s.squadId,
        scorepoints: s.scorepoints,
        homeScore: runHome,
        awayScore: runAway,
      };
    });
}

/**
 * Aggregate scorepoints per period per team into period scores.
 */
function buildPeriodScores(
  rawScores: CDRawScoreFlowEntry[],
  homeSquadId: number
): CDPeriodScore[] {
  const periodMap = new Map<number, { home: number; away: number }>();
  for (const s of rawScores.filter((s) => s.scorepoints > 0)) {
    const entry = periodMap.get(s.period) ?? { home: 0, away: 0 };
    if (s.squadId === homeSquadId) entry.home += s.scorepoints;
    else entry.away += s.scorepoints;
    periodMap.set(s.period, entry);
  }
  return Array.from(periodMap.entries()).map(([period, scores]) => ({
    period,
    homeScore: scores.home,
    awayScore: scores.away,
  }));
}

/**
 * Transform the raw Champion Data match stats response (with its
 * `matchStats` wrapper and different field names) into our normalised
 * CDMatchStatsResponse shape.
 */
export function transformRawCDMatchStats(
  raw: CDRawMatchStatsResponse,
  matchId: number
): CDMatchStatsResponse {
  const ms = raw.matchStats;
  const info = ms.matchInfo;
  const { homeSquadId, awaySquadId } = info;

  const teams = ms.teamStats?.team ?? [];
  const homeTeamStats = teams.find((t) => t.squadId === homeSquadId);
  const awayTeamStats = teams.find((t) => t.squadId === awaySquadId);

  const allPlayers = ms.playerStats?.player ?? [];
  const rawScores = ms.scoreFlow?.score ?? [];

  return {
    matchInfo: {
      matchId: info.matchId ?? matchId,
      round: info.roundNumber ?? 0,
      venue: info.venueName ?? '',
      homeSquadId,
      homeSquadName: '',
      awaySquadId,
      awaySquadName: '',
      homeScore: homeTeamStats?.points ?? 0,
      awayScore: awayTeamStats?.points ?? 0,
      matchStatus: info.matchStatus ?? '',
      period: info.period ?? 0,
      periodSeconds: info.periodSeconds ?? 0,
    },
    scoreFlow: buildScoreFlow(rawScores, homeSquadId),
    teamStats: {
      home: mapRawTeamStats(homeTeamStats),
      away: mapRawTeamStats(awayTeamStats),
    },
    playerStats: {
      home: allPlayers.filter((p) => p.squadId === homeSquadId).map(mapRawPlayer),
      away: allPlayers.filter((p) => p.squadId === awaySquadId).map(mapRawPlayer),
    },
    periodScores: buildPeriodScores(rawScores, homeSquadId),
  };
}

/**
 * Fetch detailed match stats.
 *
 * Real Champion Data wraps everything in `{ matchStats: { ... } }` with
 * different field names than our normalised CDMatchStatsResponse. The sim
 * data-generator already produces the normalised shape. This function
 * detects which format we received and transforms the raw CD response.
 */
export async function fetchMatchStats(
  compId: number,
  matchId: number
): Promise<CDMatchStatsResponse> {
  const path = SIM_MODE ? `/${matchId}.json` : `/${compId}/${matchId}.json`;
  const raw = await fetchFromChampionData<CDMatchStatsResponse | CDRawMatchStatsResponse>(path);

  // Sim format — already normalised
  if (!('matchStats' in raw)) return raw;

  // Real Champion Data format — transform
  return transformRawCDMatchStats(raw, matchId);
}

export function mapMatchStatus(cdStatus: string): MatchStatus {
  switch (cdStatus.toLowerCase()) {
    case "playing":
      return "LIVE";
    case "complete":
      return "COMPLETED";
    default:
      return "SCHEDULED";
  }
}

/**
 * Transform a Champion Data fixture match to a Prisma-compatible object.
 * Note: homeTeamId and awayTeamId are returned as champion data IDs
 * and must be resolved to Prisma IDs by the caller.
 */
interface TransformedFixtureMatch {
  championDataMatchId: number;
  round: number;
  venue: string;
  scheduledAt: Date;
  homeScore: number;
  awayScore: number;
  status: MatchStatus;
  competitionId: string;
  homeChampionDataTeamId: number;
  awayChampionDataTeamId: number;
}

export function transformFixtureMatch(
  cdMatch: CDFixtureMatch,
  competitionId: string
): TransformedFixtureMatch {
  return {
    championDataMatchId: cdMatch.matchId,
    round: cdMatch.roundNumber,
    venue: cdMatch.venueName,
    scheduledAt: new Date(cdMatch.utcStartTime),
    homeScore: cdMatch.homeSquadScore ?? 0,
    awayScore: cdMatch.awaySquadScore ?? 0,
    status: mapMatchStatus(cdMatch.matchStatus),
    competitionId,
    homeChampionDataTeamId: cdMatch.homeSquadId,
    awayChampionDataTeamId: cdMatch.awaySquadId,
  };
}

/**
 * Transform Champion Data player stats to a Prisma-compatible stats object.
 * Note: playerId is returned as championDataPlayerId and must be resolved
 * to a Prisma Player ID by the caller.
 */
interface TransformedPlayerStats extends StatValues {
  championDataPlayerId: number;
  name: string;
  position: string;
}

export function transformPlayerStats(cdPlayer: CDPlayerStats): TransformedPlayerStats {
  return {
    championDataPlayerId: cdPlayer.playerId,
    name: cdPlayer.displayName,
    position: cdPlayer.position,
    ...pickStatFields(cdPlayer),
  };
}
