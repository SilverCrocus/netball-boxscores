import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260715000000_add_competition_foundation",
  "migration.sql"
);

const newPublicTables = [
  "CompetitionSeries",
  "Ruleset",
  "Stage",
  "StageGroup",
  "StageStanding",
  "EditionEntry",
  "RosterMembership",
  "MatchSlot",
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
] as const;

function readMigration(): string {
  return fs.readFileSync(migrationPath, "utf-8");
}

describe("CP-01 competition foundation migration", () => {
  it("applies schema, backfill, verification, and security atomically", () => {
    const sql = readMigration().trim();

    expect(sql).toMatch(/^--[\s\S]*\nBEGIN;/);
    expect(sql).toMatch(/COMMIT;$/);
  });

  it("creates every foundational public table", () => {
    const sql = readMigration();

    for (const table of newPublicTables) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it("keeps old-writer-facing additions nullable or default-safe", () => {
    const sql = readMigration();

    expect(sql).toContain('ADD COLUMN "seriesId" TEXT');
    expect(sql).toContain('ADD COLUMN "rulesetId" TEXT');
    expect(sql).toContain('ADD COLUMN "stageId" TEXT');
    expect(sql).toContain('ADD COLUMN "stageGroupId" TEXT');
    expect(sql).toContain('ADD COLUMN "isSimulation" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain(
      'ADD COLUMN "resultQuality" "ResultQualityStatus" NOT NULL DEFAULT \'UNKNOWN\''
    );
    expect(sql).not.toMatch(/ALTER COLUMN "championDataId"/);
    expect(sql).not.toMatch(/ALTER COLUMN "round"/);
    expect(sql).not.toMatch(/ALTER COLUMN "homeTeamId"/);
    expect(sql).not.toMatch(/ALTER COLUMN "awayTeamId"/);
  });

  it("backfills canonical relationships and verifies completeness", () => {
    const sql = readMigration();

    expect(sql).toContain("NULL::JSONB");
    expect(sql).toContain('ON CONFLICT ("competitionId", "teamId") DO UPDATE');
    expect(sql).toContain(
      'ON CONFLICT ("editionEntryId", "playerId", "validFrom") DO UPDATE'
    );
    expect(sql).toContain('ON CONFLICT ("matchId", "side") DO UPDATE');
    expect(sql).toContain("match does not have exactly two resolved TEAM slots");
    expect(sql).toContain("team without edition entry");
    expect(sql).toContain("player without roster membership");
    expect(sql).toContain("legacy standing without stage standing");
    expect(sql).toContain('CONSTRAINT "MatchSlot_source_shape_check"');
    expect(sql).toContain('CONSTRAINT "MatchSlot_resolution_check"');
    expect(sql).toContain(
      'FOREIGN KEY ("resolvedEntryId") REFERENCES "EditionEntry"("id")\n  ON DELETE RESTRICT'
    );
  });

  it("combines Champion Data regular and finals feeds in the current edition", () => {
    const sql = readMigration();

    expect(sql).toContain('c."championDataId" = 12949');
    expect(sql).toContain("SELECT c.\"id\", 12950");
    expect(sql).toContain("SSN edition must include Champion Data 12949 and 12950");
    expect(sql).toContain('m."sourceCompetitionId" <> c."championDataId"');
    expect(sql).toContain('m."finalCode" IS NOT NULL');
  });

  it("uses explicit simulation state after the one-time legacy backfill", () => {
    const sql = readMigration();
    const dbSource = fs.readFileSync(
      path.join(process.cwd(), "src", "lib", "db.ts"),
      "utf-8"
    );
    const simulationSource = fs.readFileSync(
      path.join(process.cwd(), "src", "lib", "simulation", "engine.ts"),
      "utf-8"
    );

    expect(sql).toContain('m."isSimulation" OR m."round" = 99');
    expect(dbSource).toContain("{ isSimulation: false }");
    expect(dbSource).not.toContain("round: { not: 99 }");
    expect(simulationSource).toContain("where: { isSimulation: true }");
    expect(simulationSource).toContain("isSimulation: true");
  });

  it("keeps canonical matches complete while the previous worker is still writing", () => {
    const sql = readMigration();
    const processingSource = fs.readFileSync(
      path.join(process.cwd(), "src", "lib", "processing.ts"),
      "utf-8"
    );

    expect(sql).toContain("CREATE FUNCTION cp_prepare_legacy_match_write()");
    expect(sql).toContain('CREATE TRIGGER "Match_prepare_legacy_write"');
    expect(sql).toContain("CREATE FUNCTION cp_sync_legacy_match_foundation()");
    expect(sql).toContain('CREATE TRIGGER "Match_sync_legacy_foundation"');
    expect(sql).toContain('IF NEW."stageId" IS NULL THEN');
    expect(sql).toContain(
      'IF NEW."roundLabel" IS NULL AND NEW."round" IS NOT NULL THEN'
    );
    expect(sql).toContain(
      'NEW."isSimulation" := NEW."isSimulation" OR COALESCE(NEW."round" = 99, false)'
    );
    expect(sql).not.toContain(
      'NEW."isSimulation" := NEW."isSimulation" OR NEW."round" = 99'
    );
    expect(sql).toContain(
      'NEW."resultQuality" := \'UNOFFICIAL_FINAL\'::"ResultQualityStatus"'
    );
    expect(sql).toContain('ON CONFLICT ("matchId", "side") DO UPDATE SET');
    expect(sql).toContain("WHERE \"MatchSlot\".\"sourceType\" = 'TEAM'::\"MatchSlotSourceType\"");
    expect(sql).toContain("NEW.\"competitionId\" || ':MATCH:' || NEW.\"championDataMatchId\"::text");
    expect(processingSource).toContain("stages: {");
    expect(processingSource).toContain("sourceRetrievedAt: retrievedAt");
    expect(processingSource).toContain("resultQuality:");
    expect(processingSource).toContain("? 'PROVISIONAL'");
  });

  it("uses a concrete mutation target for every CP-03A write surface", () => {
    const sql = readMigration();
    const schema = fs.readFileSync(
      path.join(process.cwd(), "prisma", "schema.prisma"),
      "utf-8"
    );
    const requiredTargets = [
      "EDITION_ENTRY",
      "ROSTER_MEMBERSHIP",
      "MATCH_SLOT",
      "STAGE_STANDING",
      "SOURCE_ENTITY_MAPPING",
      "DATA_COVERAGE",
      "PLAYER_ALIAS",
      "TEAM_ALIAS",
    ];
    const importMutationModel = schema.match(
      /model ImportMutation \{[\s\S]*?\n\}/
    )?.[0];

    expect(sql).toContain('CREATE TYPE "ImportMutationTarget" AS ENUM');
    expect(sql).toContain('"target" "ImportMutationTarget" NOT NULL');
    expect(schema).toContain("target      ImportMutationTarget");
    expect(importMutationModel).toBeDefined();
    expect(importMutationModel).not.toMatch(/entityType\s+SourceEntityType/);
    for (const target of requiredTargets) {
      expect(sql).toContain(`'${target}'`);
      expect(schema).toContain(target);
    }
  });

  it("scopes reusable provider identifiers to an edition", () => {
    const sql = readMigration();
    const schema = fs.readFileSync(
      path.join(process.cwd(), "prisma", "schema.prisma"),
      "utf-8"
    );

    expect(sql).toContain('CREATE UNIQUE INDEX "SourceEntityMapping_edition_external_key"');
    expect(sql).toContain('WHERE "competitionId" IS NOT NULL');
    expect(sql).toContain('CREATE UNIQUE INDEX "SourceEntityMapping_global_external_key"');
    expect(sql).toContain('WHERE "competitionId" IS NULL');
    expect(sql).toContain(
      'ON CONFLICT ("sourceSystemId", "competitionId", "entityType", "externalId")'
    );
    expect(sql).toContain(
      'ON CONFLICT ("competitionId", "sourceSystemId", "externalId") DO UPDATE SET'
    );
    expect(sql).not.toContain('CREATE UNIQUE INDEX "EditionSource_sourceSystemId_externalId_key"');
    expect(schema).not.toContain("@@unique([sourceSystemId, externalId])");
    expect(schema).not.toContain("@@unique([sourceSystemId, entityType, externalId])");
  });

  it("enforces edition topology with deferred constraint triggers", () => {
    const sql = readMigration();
    const constrainedTables = [
      "Stage",
      "StageGroup",
      "EditionEntry",
      "Match",
      "MatchSlot",
      "StageStanding",
      "DataCoverage",
    ];

    expect(sql).toContain("CREATE FUNCTION cp_validate_competition_topology()");
    expect(sql).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(sql).toContain("m.\"stageId\" IS DISTINCT FROM sg.\"stageId\"");
    expect(sql).toContain("ee.\"competitionId\" <> m.\"competitionId\"");
    expect(sql).toContain("dc.\"competitionId\" <> m.\"competitionId\"");
    expect(sql).toContain(
      'AFTER INSERT OR UPDATE OR DELETE ON "MatchSlot"'
    );
    expect(sql).toContain(
      "ARRAY[old_parent_match_id, new_parent_match_id]"
    );
    expect(sql).toContain(
      "CP-01 topology violation: match must have exactly two slots"
    );
    expect(sql).toContain(
      'IF EXISTS (SELECT 1 FROM "Match" m WHERE m."id" = affected_match_id)'
    );
    for (const table of constrainedTables) {
      expect(sql).toContain(`CREATE CONSTRAINT TRIGGER "${table}_competition_topology"`);
    }
  });

  it("defers sitemap database reads until after pre-deploy migrations", () => {
    const sitemapSource = fs.readFileSync(
      path.join(process.cwd(), "src", "app", "sitemap.ts"),
      "utf-8"
    );

    expect(sitemapSource).toContain("export const dynamic = 'force-dynamic';");
  });

  it("separates edition and match coverage uniqueness", () => {
    const sql = readMigration();
    const schema = fs.readFileSync(
      path.join(process.cwd(), "prisma", "schema.prisma"),
      "utf-8"
    );

    expect(sql).toContain('CREATE UNIQUE INDEX "DataCoverage_edition_capability_key"');
    expect(sql).toContain('WHERE "matchId" IS NULL');
    expect(sql).toContain('CREATE UNIQUE INDEX "DataCoverage_match_capability_key"');
    expect(sql).toContain('WHERE "matchId" IS NOT NULL');
    expect(schema).not.toContain("@@unique([competitionId, matchId, capability])");
  });

  it("indexes every new foreign-key column", () => {
    const compactSql = readMigration().replace(/\s+/g, " ");
    const indexedForeignKeys = [
      ["Competition", "seriesId"],
      ["Competition", "rulesetId"],
      ["Stage", "competitionId"],
      ["StageGroup", "stageId"],
      ["EditionEntry", "competitionId"],
      ["EditionEntry", "teamId"],
      ["EditionEntry", "primaryGroupId"],
      ["RosterMembership", "editionEntryId"],
      ["RosterMembership", "playerId"],
      ["MatchSlot", "matchId"],
      ["MatchSlot", "resolvedEntryId"],
      ["MatchSlot", "sourceGroupId"],
      ["MatchSlot", "sourceMatchId"],
      ["StageStanding", "stageId"],
      ["StageStanding", "stageGroupId"],
      ["StageStanding", "editionEntryId"],
      ["Match", "stageId"],
      ["Match", "stageGroupId"],
      ["EditionSource", "competitionId"],
      ["EditionSource", "sourceSystemId"],
      ["SourceEntityMapping", "sourceSystemId"],
      ["SourceEntityMapping", "competitionId"],
      ["ImportRun", "sourceSystemId"],
      ["ImportRun", "competitionId"],
      ["ImportRun", "editionSourceId"],
      ["ImportIssue", "importRunId"],
      ["ImportMutation", "importRunId"],
      ["SourceSnapshot", "sourceSystemId"],
      ["SourceSnapshot", "importRunId"],
      ["SourceSnapshot", "competitionId"],
      ["DataCoverage", "competitionId"],
      ["DataCoverage", "matchId"],
      ["DataCoverage", "sourceSystemId"],
      ["PlayerAlias", "playerId"],
      ["PlayerAlias", "sourceSystemId"],
      ["TeamAlias", "teamId"],
      ["TeamAlias", "sourceSystemId"],
    ] as const;

    for (const [table, column] of indexedForeignKeys) {
      expect(compactSql).toContain(`ON "${table}"("${column}"`);
    }
  });

  it("enforces deny-by-default Supabase access on each new table", () => {
    const sql = readMigration();

    for (const table of newPublicTables) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(
        `CREATE POLICY "deny_data_api_access" ON "${table}"`
      );
      expect(sql).toContain(
        `REVOKE ALL PRIVILEGES ON TABLE "${table}" FROM anon, authenticated;`
      );
    }
  });
});
