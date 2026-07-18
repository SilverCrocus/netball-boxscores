import type {
  TSDBTeam,
  TSDBTeamsResponse,
  TSDBPlayer,
  TSDBPlayersResponse,
} from "@/types/the-sports-db";
import { fetchJsonWithinLimits } from '@/lib/bounded-fetch';

const SSN_LEAGUE_NAME = "Australian Super Netball League";
const THESPORTSDB_TIMEOUT_MS = 10_000;
const THESPORTSDB_MAX_BYTES = 2 * 1024 * 1024;

function getBaseUrl(): string {
  const apiKey = process.env.THESPORTSDB_API_KEY || "3"; // "3" is the free test key
  return (
    process.env.THESPORTSDB_BASE_URL ||
    `https://www.thesportsdb.com/api/v1/json/${apiKey}`
  );
}

async function fetchFromTSDB<T>(endpoint: string): Promise<T> {
  const url = `${getBaseUrl()}/${endpoint}`;
  return fetchJsonWithinLimits<T>({
    url,
    label: 'TheSportsDB API',
    timeoutMs: THESPORTSDB_TIMEOUT_MS,
    maxBytes: THESPORTSDB_MAX_BYTES,
    init: { next: { revalidate: 86400 } },
  });
}

/**
 * Fetch all teams in the Suncorp Super Netball league.
 */
export async function fetchTeams(leagueName = SSN_LEAGUE_NAME): Promise<TSDBTeam[]> {
  const data = await fetchFromTSDB<TSDBTeamsResponse>(
    `search_all_teams.php?l=${encodeURIComponent(leagueName)}`
  );
  return data.teams ?? [];
}

/**
 * Fetch all players for a given team.
 */
export async function fetchPlayersByTeam(teamId: string): Promise<TSDBPlayer[]> {
  const data = await fetchFromTSDB<TSDBPlayersResponse>(
    `lookup_all_players.php?id=${teamId}`
  );
  return data.player ?? [];
}
