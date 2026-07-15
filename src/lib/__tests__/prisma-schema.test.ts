import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

describe("Prisma Schema", () => {
  it("schema file exists", () => {
    const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
    expect(fs.existsSync(schemaPath)).toBe(true);
  });

  it("schema is valid (prisma validate)", () => {
    const result = execSync("npx prisma validate", {
      encoding: "utf-8",
      env: {
        ...process.env,
        DATABASE_URL:
          "postgresql://test:test@localhost:5432/test?schema=public",
        DIRECT_URL:
          "postgresql://test:test@localhost:5432/test?schema=public",
      },
    });
    expect(result).toContain("is valid");
  });

  it("schema contains all required models", () => {
    const schema = fs.readFileSync(
      path.join(process.cwd(), "prisma", "schema.prisma"),
      "utf-8"
    );
    const requiredModels = [
      "Competition",
      "CompetitionSeries",
      "Ruleset",
      "Team",
      "Standing",
      "Stage",
      "StageGroup",
      "StageStanding",
      "EditionEntry",
      "RosterMembership",
      "Player",
      "Match",
      "MatchSlot",
      "MatchQuarter",
      "PlayerMatchStats",
      "ScoreFlow",
      "SourceSystem",
      "EditionSource",
      "SourceEntityMapping",
      "ImportRun",
      "ImportIssue",
      "ImportMutation",
      "SourceSnapshot",
      "DataCoverage",
      "PlayerAlias",
      "TeamAlias",
      "User",
      "Account",
      "Session",
      "VerificationToken",
      "UserTeam",
      "UserReminder",
      "UserFavorite",
      "PollLog",
    ];
    for (const model of requiredModels) {
      expect(schema).toContain(`model ${model}`);
    }
  });

  it("schema contains required enums", () => {
    const schema = fs.readFileSync(
      path.join(process.cwd(), "prisma", "schema.prisma"),
      "utf-8"
    );
    expect(schema).toContain("enum Position");
    expect(schema).toContain("enum MatchStatus");
    expect(schema).toContain("enum ResultQualityStatus");
    expect(schema).toContain("enum DataCapability");
    expect(schema).toContain("enum CoverageState");
    expect(schema).toContain("enum MatchSlotSourceType");
    expect(schema).toContain("enum ImportMutationTarget");
  });

  it("supports provider-neutral editions and unresolved tournament fixtures", () => {
    const schema = fs.readFileSync(
      path.join(process.cwd(), "prisma", "schema.prisma"),
      "utf-8"
    );

    expect(schema).toMatch(/championDataId\s+Int\?\s+@unique/);
    expect(schema).toMatch(/homeTeamId\s+String\?\s*\n/);
    expect(schema).toMatch(/awayTeamId\s+String\?\s*\n/);
    expect(schema).toMatch(/round\s+Int\?\s*\n/);
    expect(schema).toMatch(/homeTeam\s+Team\?/);
    expect(schema).toMatch(/awayTeam\s+Team\?/);
    for (const status of ["DELAYED", "POSTPONED", "CANCELLED", "ABANDONED"]) {
      expect(schema).toContain(status);
    }
    expect(schema).toMatch(/isSimulation\s+Boolean\s+@default\(false\)/);
    expect(schema).toMatch(/resultQuality\s+ResultQualityStatus\s+@default\(UNKNOWN\)/);
    expect(schema).not.toContain("GLASGOW");
  });
});
