import type {
  CDCompetitionsResponse,
  CDFixtureResponse,
  CDMatchStatsResponse,
  CDFixtureMatch,
  CDPlayerStats,
} from "@/types/champion-data";

// MatchStatus will come from Prisma once the schema is generated.
// Define locally for now to avoid a hard dependency on Task 2.
type MatchStatus = "SCHEDULED" | "LIVE" | "COMPLETED";

const BASE_URL =
  process.env.CHAMPION_DATA_BASE_URL || "https://mc.championdata.com/data";

async function fetchFromChampionData<T>(path: string, revalidate = 3600): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { next: { revalidate } });

  if (!res.ok) {
    throw new Error(`Champion Data API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Fetch all available competitions.
 */
export async function fetchCompetitions(): Promise<CDCompetitionsResponse> {
  return fetchFromChampionData<CDCompetitionsResponse>("/competitions.json", 86400);
}

/**
 * Fetch fixture (schedule + results) for a competition.
 */
export async function fetchFixture(compId: number): Promise<CDFixtureResponse> {
  return fetchFromChampionData<CDFixtureResponse>(`/${compId}/fixture.json`, 900);
}

/**
 * Fetch detailed match stats.
 */
export async function fetchMatchStats(
  compId: number,
  matchId: number
): Promise<CDMatchStatsResponse> {
  return fetchFromChampionData<CDMatchStatsResponse>(`/${compId}/${matchId}.json`, 30);
}

// ───── Transform functions ─────

function mapMatchStatus(cdStatus: string): MatchStatus {
  switch (cdStatus) {
    case "Playing":
      return "LIVE";
    case "Complete":
      return "COMPLETED";
    case "Scheduled":
    default:
      return "SCHEDULED";
  }
}

/**
 * Transform a Champion Data fixture match to a Prisma-compatible object.
 * Note: homeTeamId and awayTeamId are returned as champion data IDs
 * and must be resolved to Prisma IDs by the caller.
 */
export function transformFixtureMatch(
  cdMatch: CDFixtureMatch,
  competitionId: string
) {
  return {
    championDataMatchId: cdMatch.matchId,
    round: cdMatch.round,
    venue: cdMatch.venue,
    scheduledAt: new Date(cdMatch.utcStartTime),
    homeScore: cdMatch.homeScore ?? 0,
    awayScore: cdMatch.awayScore ?? 0,
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
export function transformPlayerStats(cdPlayer: CDPlayerStats) {
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
