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
      "Team",
      "Standing",
      "Player",
      "Match",
      "MatchQuarter",
      "PlayerMatchStats",
      "ScoreFlow",
      "User",
      "Account",
      "Session",
      "VerificationToken",
      "UserTeam",
      "UserReminder",
      "UserFavorite",
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
  });
});
