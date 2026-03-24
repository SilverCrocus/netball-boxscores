import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchCompetitions,
  fetchFixture,
  fetchMatchStats,
  transformFixtureMatch,
  transformPlayerStats,
} from "@/lib/champion-data";
import type {
  CDCompetitionsResponse,
  CDFixtureResponse,
  CDMatchStatsResponse,
  CDFixtureMatch,
  CDPlayerStats,
} from "@/types/champion-data";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

// ───── Mock data ─────

const mockCompetitionsResponse: CDCompetitionsResponse = {
  competitions: [
    { id: 10850, name: "Suncorp Super Netball 2026", season: 2026, sport: "netball" },
    { id: 10724, name: "Suncorp Super Netball 2025", season: 2025, sport: "netball" },
  ],
};

const mockFixtureResponse: CDFixtureResponse = {
  fixture: {
    jobId: 1,
    match: [
      {
        matchId: 115001,
        matchNumber: 1,
        matchType: "Regular",
        roundNumber: 1,
        homeSquadId: 810,
        homeSquadName: "Melbourne Vixens",
        homeSquadCode: "VIX",
        homeSquadShortCode: "VIX",
        homeSquadNickname: "Vixens",
        homeSquadScore: 64,
        awaySquadId: 811,
        awaySquadName: "West Coast Fever",
        awaySquadCode: "FEV",
        awaySquadShortCode: "FEV",
        awaySquadNickname: "Fever",
        awaySquadScore: 58,
        venue: "John Cain Arena",
        venueName: "John Cain Arena",
        venueId: 100,
        venueCode: "JCA",
        localStartTime: "2026-03-28T17:00:00+11:00",
        utcStartTime: "2026-03-28T06:00:00Z",
        matchStatus: "complete",
        period: 4,
        periodSecs: 0,
        periodCompleted: 4,
        isNetball2pt: false,
        finalCode: "FT",
        finalShortCode: "FT",
      },
    ],
  },
};

const mockMatchStatsResponse: CDMatchStatsResponse = {
  matchInfo: {
    matchId: 115001,
    round: 1,
    venue: "John Cain Arena",
    homeSquadId: 810,
    homeSquadName: "Melbourne Vixens",
    awaySquadId: 811,
    awaySquadName: "West Coast Fever",
    homeScore: 64,
    awayScore: 58,
    matchStatus: "Complete",
    period: 4,
    periodSeconds: 0,
  },
  scoreFlow: [
    { period: 1, periodSeconds: 45, squadId: 810, scorepoints: 1, homeScore: 1, awayScore: 0 },
    { period: 1, periodSeconds: 90, squadId: 811, scorepoints: 1, homeScore: 1, awayScore: 1 },
  ],
  teamStats: {
    home: {
      squadId: 810,
      goals: 64,
      attempts: 70,
      goalAssists: 18,
      intercepts: 8,
      deflections: 14,
      rebounds: 12,
      penalties: 6,
      feeds: 42,
      centrePassReceives: 30,
      turnovers: 15,
    },
    away: {
      squadId: 811,
      goals: 58,
      attempts: 68,
      goalAssists: 14,
      intercepts: 6,
      deflections: 10,
      rebounds: 8,
      penalties: 8,
      feeds: 38,
      centrePassReceives: 28,
      turnovers: 18,
    },
  },
  playerStats: {
    home: [
      {
        playerId: 9000,
        displayName: "Mwai Kumwenda",
        position: "GS",
        squadId: 810,
        goals: 42,
        attempts: 45,
        goalAssists: 0,
        intercepts: 0,
        deflections: 1,
        rebounds: 4,
        penalties: 2,
        feeds: 3,
        centrePassReceives: 0,
        turnovers: 2,
        minutesPlayed: 60,
      },
    ],
    away: [
      {
        playerId: 9010,
        displayName: "Jhaniele Fowler",
        position: "GS",
        squadId: 811,
        goals: 38,
        attempts: 42,
        goalAssists: 0,
        intercepts: 0,
        deflections: 0,
        rebounds: 3,
        penalties: 1,
        feeds: 2,
        centrePassReceives: 0,
        turnovers: 3,
        minutesPlayed: 60,
      },
    ],
  },
  periodScores: [
    { period: 1, homeScore: 16, awayScore: 14 },
    { period: 2, homeScore: 14, awayScore: 17 },
    { period: 3, homeScore: 18, awayScore: 12 },
    { period: 4, homeScore: 16, awayScore: 15 },
  ],
};

// ───── Tests ─────

describe("Champion Data Service", () => {
  describe("fetchCompetitions", () => {
    it("fetches and returns competitions", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCompetitionsResponse,
      });

      const result = await fetchCompetitions();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://mc.championdata.com/data/competitions.json",
        expect.objectContaining({ next: { revalidate: expect.any(Number) } })
      );
      expect(result.competitions).toHaveLength(2);
      expect(result.competitions[0].id).toBe(10850);
    });

    it("throws on fetch failure", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" });

      await expect(fetchCompetitions()).rejects.toThrow("Champion Data API error: 500 Internal Server Error");
    });
  });

  describe("fetchFixture", () => {
    it("fetches fixture for a given competition", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFixtureResponse,
      });

      const result = await fetchFixture(10850);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://mc.championdata.com/data/10850/fixture.json",
        expect.any(Object)
      );
      expect(result).toHaveLength(1);
      expect(result[0].matchId).toBe(115001);
    });
  });

  describe("fetchMatchStats", () => {
    it("fetches match stats for a given competition and match", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockMatchStatsResponse,
      });

      const result = await fetchMatchStats(10850, 115001);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://mc.championdata.com/data/10850/115001.json",
        expect.any(Object)
      );
      expect(result.matchInfo.homeScore).toBe(64);
      expect(result.playerStats.home).toHaveLength(1);
    });
  });

  describe("transformFixtureMatch", () => {
    it("transforms CDFixtureMatch to Prisma-compatible format", () => {
      const cdMatch: CDFixtureMatch = mockFixtureResponse.fixture.match[0];
      const result = transformFixtureMatch(cdMatch, "comp-id-123");

      expect(result).toEqual({
        championDataMatchId: 115001,
        round: 1,
        venue: "John Cain Arena",
        scheduledAt: new Date("2026-03-28T06:00:00Z"),
        homeScore: 64,
        awayScore: 58,
        status: "COMPLETED",
        competitionId: "comp-id-123",
        homeChampionDataTeamId: 810,
        awayChampionDataTeamId: 811,
      });
    });

    it("maps 'Playing' status to LIVE", () => {
      const liveMatch: CDFixtureMatch = {
        ...mockFixtureResponse.fixture.match[0],
        matchStatus: "playing",
      };
      const result = transformFixtureMatch(liveMatch, "comp-id-123");
      expect(result.status).toBe("LIVE");
    });

    it("maps 'Scheduled' status to SCHEDULED", () => {
      const scheduledMatch: CDFixtureMatch = {
        ...mockFixtureResponse.fixture.match[0],
        matchStatus: "scheduled",
        homeSquadScore: undefined as unknown as number,
        awaySquadScore: undefined as unknown as number,
      };
      const result = transformFixtureMatch(scheduledMatch, "comp-id-123");
      expect(result.status).toBe("SCHEDULED");
      expect(result.homeScore).toBe(0);
      expect(result.awayScore).toBe(0);
    });
  });

  describe("transformPlayerStats", () => {
    it("transforms CDPlayerStats to Prisma-compatible format", () => {
      const cdPlayer: CDPlayerStats = mockMatchStatsResponse.playerStats.home[0];
      const result = transformPlayerStats(cdPlayer);

      expect(result).toEqual({
        championDataPlayerId: 9000,
        name: "Mwai Kumwenda",
        position: "GS",
        goals: 42,
        attempts: 45,
        goalAssists: 0,
        intercepts: 0,
        deflections: 1,
        rebounds: 4,
        penalties: 2,
        feeds: 3,
        centrePassReceives: 0,
        turnovers: 2,
        minutesPlayed: 60,
      });
    });
  });
});
