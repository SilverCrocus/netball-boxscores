import type {
  TSDBTeam,
  TSDBTeamsResponse,
  TSDBPlayer,
  TSDBPlayersResponse,
} from "@/types/the-sports-db";

const SSN_LEAGUE_NAME = "Australian Super Netball League";

function getBaseUrl(): string {
  const apiKey = process.env.THESPORTSDB_API_KEY || "3"; // "3" is the free test key
  return (
    process.env.THESPORTSDB_BASE_URL ||
    `https://www.thesportsdb.com/api/v1/json/${apiKey}`
  );
}

async function fetchFromTSDB<T>(endpoint: string): Promise<T> {
  const url = `${getBaseUrl()}/${endpoint}`;
  const res = await fetch(url, { next: { revalidate: 86400 } });

  if (!res.ok) {
    throw new Error(`TheSportsDB API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
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

