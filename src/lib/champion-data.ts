import type {
  CDFixtureResponse,
  CDFixtureMatch,
  CDMatchStatsResponse,
  CDPlayerStats,
  CDScoreFlowEntry,
  CDPeriodScore,
  CDTeamStats,
} from "@/types/champion-data";

type MatchStatus = "SCHEDULED" | "LIVE" | "COMPLETED";

const SIM_MODE = process.env.SIMULATION_MODE === 'true' && process.env.NODE_ENV !== 'production';
const SIM_BASE = `http://localhost:${process.env.PORT || 3000}/api/sim`;
const CD_BASE =
  process.env.CHAMPION_DATA_BASE_URL || 'https://mc.championdata.com/data';

async function fetchFromChampionData<T>(path: string): Promise<T> {
  const baseUrl = SIM_MODE ? SIM_BASE : CD_BASE;
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, { cache: 'no-store' });

  if (!res.ok) {
    throw new Error(`Champion Data API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await fetchFromChampionData<any>(path);

  // Sim format — already normalised
  if (!raw.matchStats) return raw as CDMatchStatsResponse;

  // Real Champion Data format — transform
  const ms = raw.matchStats;
  const info = ms.matchInfo;
  const homeSquadId: number = info.homeSquadId;
  const awaySquadId: number = info.awaySquadId;

  // Scores live in teamStats.team[], keyed by squadId — use `points` (includes super shots)
  const teams: Array<{ squadId: number; points: number; goals: number; [k: string]: unknown }> =
    ms.teamStats?.team ?? [];
  const homeTeamStats = teams.find((t) => t.squadId === homeSquadId);
  const awayTeamStats = teams.find((t) => t.squadId === awaySquadId);

  // Player stats: flat array → split by squad, rename fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allPlayers: any[] = ms.playerStats?.player ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapPlayer = (p: any): CDPlayerStats => ({
    playerId: p.playerId,
    displayName: p.displayName ?? '',
    position: p.currentPositionCode ?? p.startingPositionCode ?? '',
    squadId: p.squadId,
    goals: p.goals ?? 0,
    attempts: p.goalAttempts ?? 0,
    goalAssists: p.goalAssists ?? 0,
    intercepts: p.intercepts ?? 0,
    deflections: p.deflections ?? 0,
    rebounds: p.rebounds ?? 0,
    penalties: p.penalties ?? 0,
    feeds: p.feeds ?? 0,
    centrePassReceives: p.centrePassReceives ?? 0,
    turnovers: p.generalPlayTurnovers ?? 0,
    minutesPlayed: p.minutesPlayed ?? 0,
  });

  // Score flow: unwrap {score: [...]}, filter to actual goals, compute running totals
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawScores: any[] = ms.scoreFlow?.score ?? [];
  rawScores.sort((a: { period: number; periodSeconds: number }, b: { period: number; periodSeconds: number }) =>
    a.period - b.period || a.periodSeconds - b.periodSeconds
  );
  let runHome = 0;
  let runAway = 0;
  const scoreFlow: CDScoreFlowEntry[] = rawScores
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

  // Period scores: aggregate scorepoints per period per team
  const periodMap = new Map<number, { home: number; away: number }>();
  for (const s of rawScores.filter((s) => s.scorepoints > 0)) {
    const entry = periodMap.get(s.period) ?? { home: 0, away: 0 };
    if (s.squadId === homeSquadId) entry.home += s.scorepoints;
    else entry.away += s.scorepoints;
    periodMap.set(s.period, entry);
  }
  const periodScores: CDPeriodScore[] = Array.from(periodMap.entries()).map(
    ([period, scores]) => ({ period, homeScore: scores.home, awayScore: scores.away })
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapTeamStats = (t: any): CDTeamStats => ({
    squadId: t?.squadId ?? 0,
    goals: t?.goals ?? 0,
    attempts: t?.goalAttempts ?? 0,
    goalAssists: t?.goalAssists ?? 0,
    intercepts: t?.intercepts ?? 0,
    deflections: t?.deflections ?? 0,
    rebounds: t?.rebounds ?? 0,
    penalties: t?.penalties ?? 0,
    feeds: t?.feeds ?? 0,
    centrePassReceives: t?.centrePassReceives ?? 0,
    turnovers: t?.generalPlayTurnovers ?? 0,
  });

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
    scoreFlow,
    teamStats: {
      home: mapTeamStats(homeTeamStats),
      away: mapTeamStats(awayTeamStats),
    },
    playerStats: {
      home: allPlayers.filter((p) => p.squadId === homeSquadId).map(mapPlayer),
      away: allPlayers.filter((p) => p.squadId === awaySquadId).map(mapPlayer),
    },
    periodScores,
  };
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
interface TransformedPlayerStats {
  championDataPlayerId: number;
  name: string;
  position: string;
  goals: number;
  attempts: number;
  goalAssists: number;
  intercepts: number;
  deflections: number;
  rebounds: number;
  penalties: number;
  feeds: number;
  centrePassReceives: number;
  turnovers: number;
  minutesPlayed: number;
}

export function transformPlayerStats(cdPlayer: CDPlayerStats): TransformedPlayerStats {
  return {
    championDataPlayerId: cdPlayer.playerId,
    name: cdPlayer.displayName,
    position: cdPlayer.position,
    goals: cdPlayer.goals,
    attempts: cdPlayer.attempts,
    goalAssists: cdPlayer.goalAssists,
    intercepts: cdPlayer.intercepts,
    deflections: cdPlayer.deflections,
    rebounds: cdPlayer.rebounds,
    penalties: cdPlayer.penalties,
    feeds: cdPlayer.feeds,
    centrePassReceives: cdPlayer.centrePassReceives,
    turnovers: cdPlayer.turnovers,
    minutesPlayed: cdPlayer.minutesPlayed,
  };
}
