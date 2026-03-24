import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchTeams,
  fetchPlayersByTeam,
  fetchTeamBadge,
} from "@/lib/the-sports-db";
import type {
  TSDBTeamsResponse,
  TSDBPlayersResponse,
} from "@/types/the-sports-db";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

// ───── Mock data ─────

const mockTeamsResponse: TSDBTeamsResponse = {
  teams: [
    {
      idTeam: "149291",
      strTeam: "Melbourne Vixens",
      strTeamShort: "VIX",
      strAlternate: "Vixens",
      strLeague: "Suncorp Super Netball",
      strBadge: "https://www.thesportsdb.com/images/media/team/badge/vixens.png",
      strBanner: "https://www.thesportsdb.com/images/media/team/banner/vixens.jpg",
      strDescriptionEN: "The Melbourne Vixens are an Australian netball team.",
      strCountry: "Australia",
      strStadium: "John Cain Arena",
      strTeamJersey: "https://www.thesportsdb.com/images/media/team/jersey/vixens.png",
      strTeamFanart1: "",
      strTeamFanart2: "",
      strTeamFanart3: "",
    },
  ],
};

const mockPlayersResponse: TSDBPlayersResponse = {
  player: [
    {
      idPlayer: "34186452",
      strPlayer: "Mwai Kumwenda",
      strPosition: "Goal Shooter",
      strNationality: "Malawi",
      strThumb: "https://www.thesportsdb.com/images/media/player/thumb/kumwenda.jpg",
      strCutout: "",
      strRender: "",
      dateBorn: "1993-08-22",
      strDescriptionEN: "Malawian netball player.",
      strTeam: "Melbourne Vixens",
      strHeight: "5 ft 11 in",
      strBirthLocation: "Dedza, Malawi",
    },
  ],
};

// ───── Tests ─────

describe("TheSportsDB Service", () => {
  describe("fetchTeams", () => {
    it("fetches teams for SSN league (id: 4540)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTeamsResponse,
      });

      const result = await fetchTeams();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("search_all_teams.php?l="),
        expect.any(Object)
      );
      expect(result).toHaveLength(1);
      expect(result[0].strTeam).toBe("Melbourne Vixens");
    });

    it("returns empty array when API returns null teams", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ teams: null }),
      });

      const result = await fetchTeams();
      expect(result).toEqual([]);
    });

    it("throws on fetch failure", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" });

      await expect(fetchTeams()).rejects.toThrow("TheSportsDB API error: 404 Not Found");
    });
  });

  describe("fetchPlayersByTeam", () => {
    it("fetches players for a given team ID", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPlayersResponse,
      });

      const result = await fetchPlayersByTeam("149291");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("lookup_all_players.php?id=149291"),
        expect.any(Object)
      );
      expect(result).toHaveLength(1);
      expect(result[0].strPlayer).toBe("Mwai Kumwenda");
    });

    it("returns empty array when API returns null players", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ player: null }),
      });

      const result = await fetchPlayersByTeam("999999");
      expect(result).toEqual([]);
    });
  });

  describe("fetchTeamBadge", () => {
    it("returns badge URL for a team", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ teams: [{ strBadge: "https://example.com/badge.png" }] }),
      });

      const result = await fetchTeamBadge("149291");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("lookupteam.php?id=149291"),
        expect.any(Object)
      );
      expect(result).toBe("https://example.com/badge.png");
    });

    it("returns null when team not found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ teams: null }),
      });

      const result = await fetchTeamBadge("000000");
      expect(result).toBeNull();
    });
  });
});
