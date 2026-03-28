import type {
  CDFixtureResponse,
  CDFixtureMatch,
  CDMatchStatsResponse,
  CDPlayerStats,
} from "@/types/champion-data";

type MatchStatus = "SCHEDULED" | "LIVE" | "COMPLETED";

const SIM_MODE = process.env.SIMULATION_MODE === 'true' && process.env.NODE_ENV !== 'production';
const SIM_BASE = `http://localhost:${process.env.PORT || 3000}/api/sim`;
const CD_BASE =
  process.env.CHAMPION_DATA_BASE_URL || 'https://mc.championdata.com/data';

async function fetchFromChampionData<T>(path: string, revalidate = 3600): Promise<T> {
  const baseUrl = SIM_MODE ? SIM_BASE : CD_BASE;
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, SIM_MODE ? {} : { next: { revalidate } });

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
  const data = await fetchFromChampionData<CDFixtureResponse>(path, 900);
  return data.fixture?.match ?? [];
}

/**
 * Fetch detailed match stats.
 */
export async function fetchMatchStats(
  compId: number,
  matchId: number
): Promise<CDMatchStatsResponse> {
  // In sim mode, skip compId — sim routes serve at /api/sim/{matchId}.json
  const path = SIM_MODE ? `/${matchId}.json` : `/${compId}/${matchId}.json`;
  return fetchFromChampionData<CDMatchStatsResponse>(path, 30);
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
