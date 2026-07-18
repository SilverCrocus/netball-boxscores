-- CP-01: additive competition, identity, provenance, and coverage foundation.
--
-- This migration deliberately leaves every legacy identifier and required field
-- in place so the previous application release remains compatible while Render
-- rolls forward. The set-based backfill is idempotent where practical and does
-- not depend on any environment-specific cuid values.

BEGIN;

-- CreateEnum
CREATE TYPE "CompetitionKind" AS ENUM ('LEAGUE', 'TOURNAMENT');
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "StageType" AS ENUM (
  'REGULAR_SEASON',
  'FINALS',
  'POOL',
  'CLASSIFICATION',
  'SEMI_FINALS',
  'MEDAL_MATCHES',
  'OTHER'
);
CREATE TYPE "EditionEntryStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'DISQUALIFIED');
CREATE TYPE "RosterMembershipStatus" AS ENUM ('ACTIVE', 'REPLACED', 'WITHDRAWN');
CREATE TYPE "MatchSide" AS ENUM ('A', 'B');
CREATE TYPE "ResultQualityStatus" AS ENUM (
  'UNKNOWN',
  'PROVISIONAL',
  'UNOFFICIAL_FINAL',
  'OFFICIAL_FINAL',
  'CORRECTED'
);
CREATE TYPE "MatchSlotSourceType" AS ENUM (
  'TEAM',
  'GROUP_RANK',
  'MATCH_WINNER',
  'MATCH_LOSER',
  'UNRESOLVED'
);
CREATE TYPE "SourceSystemKind" AS ENUM ('OFFICIAL_FEED', 'PUBLIC_PAGE', 'MANUAL', 'OTHER');
CREATE TYPE "SourceEntityType" AS ENUM (
  'COMPETITION_SERIES',
  'COMPETITION_EDITION',
  'RULESET',
  'STAGE',
  'GROUP',
  'TEAM',
  'PLAYER',
  'MATCH',
  'VENUE'
);
CREATE TYPE "ImportTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'REPLAY');
CREATE TYPE "ImportStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'PARTIAL',
  'FAILED',
  'ROLLED_BACK'
);
CREATE TYPE "ImportIssueSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR');
CREATE TYPE "ImportIssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');
CREATE TYPE "ImportMutationOperation" AS ENUM ('INSERT', 'UPDATE', 'DELETE');
CREATE TYPE "ImportMutationTarget" AS ENUM (
  'COMPETITION_SERIES',
  'COMPETITION_EDITION',
  'RULESET',
  'STAGE',
  'STAGE_GROUP',
  'EDITION_ENTRY',
  'ROSTER_MEMBERSHIP',
  'MATCH_SLOT',
  'STAGE_STANDING',
  'TEAM',
  'PLAYER',
  'MATCH',
  'MATCH_QUARTER',
  'PLAYER_MATCH_STATS',
  'TEAM_MATCH_STATS',
  'SCORE_FLOW',
  'MATCH_EVENT',
  'SOURCE_SYSTEM',
  'EDITION_SOURCE',
  'SOURCE_ENTITY_MAPPING',
  'SOURCE_SNAPSHOT',
  'DATA_COVERAGE',
  'PLAYER_ALIAS',
  'TEAM_ALIAS'
);
CREATE TYPE "DataCapability" AS ENUM (
  'FINAL_SCORE',
  'PERIOD_SCORES',
  'TEAM_BOX_SCORE',
  'PLAYER_BOX_SCORE',
  'SCORE_FLOW',
  'MATCH_EVENTS',
  'SUBSTITUTIONS',
  'NET_POINTS',
  'SUPER_SHOTS',
  'LINEUPS'
);
CREATE TYPE "CoverageState" AS ENUM ('AVAILABLE', 'PARTIAL', 'PROVISIONAL', 'UNAVAILABLE');

-- AlterTable: all fields are nullable or default-safe for the old writer.
ALTER TABLE "Competition"
  ADD COLUMN "label" TEXT,
  ADD COLUMN "publicationStatus" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "rulesetId" TEXT,
  ADD COLUMN "seriesId" TEXT,
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "sourceTimezone" TEXT NOT NULL DEFAULT 'Australia/Sydney';

ALTER TABLE "Match"
  ADD COLUMN "isSimulation" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "neutralVenue" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "resultQuality" "ResultQualityStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "roundLabel" TEXT,
  ADD COLUMN "sourceRetrievedAt" TIMESTAMP(3),
  ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "stageGroupId" TEXT,
  ADD COLUMN "stageId" TEXT;

-- CreateTable: competition and edition structure.
CREATE TABLE "CompetitionSeries" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "CompetitionKind" NOT NULL DEFAULT 'LEAGUE',
  "governingBody" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompetitionSeries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Ruleset" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "periodCount" INTEGER NOT NULL DEFAULT 4,
  "regulationPeriodMinutes" INTEGER NOT NULL DEFAULT 15,
  "extraTimePolicy" TEXT,
  "scoringModel" TEXT NOT NULL DEFAULT 'STANDARD',
  "standingsStrategyKey" TEXT NOT NULL DEFAULT 'STANDARD',
  "superShotsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Ruleset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Ruleset_periodCount_check" CHECK ("periodCount" > 0),
  CONSTRAINT "Ruleset_regulationPeriodMinutes_check" CHECK ("regulationPeriodMinutes" > 0)
);

CREATE TABLE "Stage" (
  "id" TEXT NOT NULL,
  "competitionId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "StageType" NOT NULL,
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "isPublished" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "Stage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Stage_sequence_check" CHECK ("sequence" >= 0),
  CONSTRAINT "Stage_dates_check" CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" >= "startsAt")
);

CREATE TABLE "StageGroup" (
  "id" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "StageGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StageGroup_sequence_check" CHECK ("sequence" >= 0)
);

CREATE TABLE "EditionEntry" (
  "id" TEXT NOT NULL,
  "competitionId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "primaryGroupId" TEXT,
  "status" "EditionEntryStatus" NOT NULL DEFAULT 'ACTIVE',
  "seed" INTEGER,
  "displayName" TEXT,
  "enteredAt" TIMESTAMP(3),
  "withdrawnAt" TIMESTAMP(3),
  CONSTRAINT "EditionEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EditionEntry_seed_check" CHECK ("seed" IS NULL OR "seed" > 0)
);

CREATE TABLE "RosterMembership" (
  "id" TEXT NOT NULL,
  "editionEntryId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "status" "RosterMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validTo" TIMESTAMP(3),
  "designatedPosition" "Position",
  "bib" TEXT,
  "isCaptain" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  CONSTRAINT "RosterMembership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RosterMembership_dates_check" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom")
);

CREATE TABLE "MatchSlot" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "side" "MatchSide" NOT NULL,
  "sourceType" "MatchSlotSourceType" NOT NULL,
  "resolvedEntryId" TEXT,
  "sourceGroupId" TEXT,
  "sourceRank" INTEGER,
  "sourceMatchId" TEXT,
  "sourceLabel" TEXT,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "MatchSlot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MatchSlot_sourceRank_check" CHECK ("sourceRank" IS NULL OR "sourceRank" > 0),
  CONSTRAINT "MatchSlot_no_self_source_check" CHECK ("sourceMatchId" IS NULL OR "sourceMatchId" <> "matchId"),
  CONSTRAINT "MatchSlot_resolution_check" CHECK ("resolvedAt" IS NULL OR "resolvedEntryId" IS NOT NULL),
  CONSTRAINT "MatchSlot_source_shape_check" CHECK (
    (
      "sourceType" = 'TEAM'
      AND "resolvedEntryId" IS NOT NULL
      AND "sourceGroupId" IS NULL
      AND "sourceRank" IS NULL
      AND "sourceMatchId" IS NULL
    )
    OR (
      "sourceType" = 'GROUP_RANK'
      AND "sourceGroupId" IS NOT NULL
      AND "sourceRank" IS NOT NULL
      AND "sourceMatchId" IS NULL
    )
    OR (
      "sourceType" IN ('MATCH_WINNER', 'MATCH_LOSER')
      AND "sourceMatchId" IS NOT NULL
      AND "sourceGroupId" IS NULL
      AND "sourceRank" IS NULL
    )
    OR (
      "sourceType" = 'UNRESOLVED'
      AND "resolvedEntryId" IS NULL
      AND "sourceGroupId" IS NULL
      AND "sourceRank" IS NULL
      AND "sourceMatchId" IS NULL
    )
  )
);

CREATE TABLE "StageStanding" (
  "id" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "stageGroupId" TEXT,
  "editionEntryId" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "played" INTEGER NOT NULL DEFAULT 0,
  "wins" INTEGER NOT NULL DEFAULT 0,
  "losses" INTEGER NOT NULL DEFAULT 0,
  "draws" INTEGER NOT NULL DEFAULT 0,
  "goalsFor" INTEGER NOT NULL DEFAULT 0,
  "goalsAgainst" INTEGER NOT NULL DEFAULT 0,
  "goalPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "points" INTEGER NOT NULL DEFAULT 0,
  "tiebreakData" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StageStanding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StageStanding_rank_check" CHECK ("rank" > 0),
  CONSTRAINT "StageStanding_counts_check" CHECK (
    "played" >= 0
    AND "wins" >= 0
    AND "losses" >= 0
    AND "draws" >= 0
    AND "goalsFor" >= 0
    AND "goalsAgainst" >= 0
  )
);

-- CreateTable: provider-neutral source, audit, and coverage records.
CREATE TABLE "SourceSystem" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "SourceSystemKind" NOT NULL,
  "baseUrl" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "rawPayloadStorageAllowed" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceSystem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EditionSource" (
  "id" TEXT NOT NULL,
  "competitionId" TEXT NOT NULL,
  "sourceSystemId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "config" JSONB,
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EditionSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EditionSource_priority_check" CHECK ("priority" >= 0),
  CONSTRAINT "EditionSource_externalId_check" CHECK (length(btrim("externalId")) > 0)
);

CREATE TABLE "SourceEntityMapping" (
  "id" TEXT NOT NULL,
  "sourceSystemId" TEXT NOT NULL,
  "competitionId" TEXT,
  "entityType" "SourceEntityType" NOT NULL,
  "externalId" TEXT NOT NULL,
  "internalEntityId" TEXT NOT NULL,
  "metadata" JSONB,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceEntityMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SourceEntityMapping_externalId_check" CHECK (length(btrim("externalId")) > 0),
  CONSTRAINT "SourceEntityMapping_internalEntityId_check" CHECK (length(btrim("internalEntityId")) > 0)
);

CREATE TABLE "ImportRun" (
  "id" TEXT NOT NULL,
  "sourceSystemId" TEXT NOT NULL,
  "competitionId" TEXT,
  "editionSourceId" TEXT,
  "trigger" "ImportTrigger" NOT NULL,
  "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
  "dryRun" BOOLEAN NOT NULL DEFAULT true,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "retrievedAt" TIMESTAMP(3),
  "checksum" TEXT,
  "insertedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "issueCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "metadata" JSONB,
  CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImportRun_counts_check" CHECK (
    "insertedCount" >= 0
    AND "updatedCount" >= 0
    AND "skippedCount" >= 0
    AND "issueCount" >= 0
  ),
  CONSTRAINT "ImportRun_dates_check" CHECK ("completedAt" IS NULL OR "completedAt" >= "startedAt")
);

CREATE TABLE "ImportIssue" (
  "id" TEXT NOT NULL,
  "importRunId" TEXT NOT NULL,
  "severity" "ImportIssueSeverity" NOT NULL,
  "status" "ImportIssueStatus" NOT NULL DEFAULT 'OPEN',
  "code" TEXT NOT NULL,
  "entityType" "SourceEntityType",
  "externalId" TEXT,
  "fieldPath" TEXT,
  "message" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "ImportIssue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImportIssue_code_check" CHECK (length(btrim("code")) > 0),
  CONSTRAINT "ImportIssue_message_check" CHECK (length(btrim("message")) > 0)
);

CREATE TABLE "ImportMutation" (
  "id" TEXT NOT NULL,
  "importRunId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "operation" "ImportMutationOperation" NOT NULL,
  "target" "ImportMutationTarget" NOT NULL,
  "entityId" TEXT NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB,
  "reversible" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revertedAt" TIMESTAMP(3),
  CONSTRAINT "ImportMutation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImportMutation_sequence_check" CHECK ("sequence" >= 0),
  CONSTRAINT "ImportMutation_entityId_check" CHECK (length(btrim("entityId")) > 0)
);

CREATE TABLE "SourceSnapshot" (
  "id" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "sourceSystemId" TEXT NOT NULL,
  "importRunId" TEXT,
  "competitionId" TEXT,
  "entityType" "SourceEntityType",
  "externalId" TEXT,
  "sourceUrl" TEXT,
  "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sourceUpdatedAt" TIMESTAMP(3),
  "checksum" TEXT NOT NULL,
  "rawPayload" JSONB,
  "metadata" JSONB,
  CONSTRAINT "SourceSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SourceSnapshot_dedupeKey_check" CHECK (length(btrim("dedupeKey")) > 0),
  CONSTRAINT "SourceSnapshot_checksum_check" CHECK (length(btrim("checksum")) > 0)
);

CREATE TABLE "DataCoverage" (
  "id" TEXT NOT NULL,
  "competitionId" TEXT NOT NULL,
  "matchId" TEXT,
  "sourceSystemId" TEXT,
  "capability" "DataCapability" NOT NULL,
  "state" "CoverageState" NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "details" JSONB,
  CONSTRAINT "DataCoverage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerAlias" (
  "id" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "sourceSystemId" TEXT,
  "alias" TEXT NOT NULL,
  "normalizedAlias" TEXT NOT NULL,
  "locale" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlayerAlias_alias_check" CHECK (length(btrim("alias")) > 0),
  CONSTRAINT "PlayerAlias_normalizedAlias_check" CHECK (length(btrim("normalizedAlias")) > 0)
);

CREATE TABLE "TeamAlias" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "sourceSystemId" TEXT,
  "alias" TEXT NOT NULL,
  "normalizedAlias" TEXT NOT NULL,
  "locale" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamAlias_alias_check" CHECK (length(btrim("alias")) > 0),
  CONSTRAINT "TeamAlias_normalizedAlias_check" CHECK (length(btrim("normalizedAlias")) > 0)
);

-- Indexes. Every new foreign key has a usable leading-column index.
CREATE UNIQUE INDEX "CompetitionSeries_slug_key" ON "CompetitionSeries"("slug");
CREATE UNIQUE INDEX "Ruleset_slug_key" ON "Ruleset"("slug");

CREATE INDEX "Competition_seriesId_idx" ON "Competition"("seriesId");
CREATE INDEX "Competition_rulesetId_idx" ON "Competition"("rulesetId");
CREATE INDEX "Competition_publicationStatus_seasonStart_idx"
  ON "Competition"("publicationStatus", "seasonStart");
CREATE UNIQUE INDEX "Competition_seriesId_slug_key" ON "Competition"("seriesId", "slug");

CREATE INDEX "Stage_competitionId_sequence_idx" ON "Stage"("competitionId", "sequence");
CREATE UNIQUE INDEX "Stage_competitionId_slug_key" ON "Stage"("competitionId", "slug");
CREATE INDEX "StageGroup_stageId_sequence_idx" ON "StageGroup"("stageId", "sequence");
CREATE UNIQUE INDEX "StageGroup_stageId_slug_key" ON "StageGroup"("stageId", "slug");

CREATE INDEX "EditionEntry_competitionId_status_idx" ON "EditionEntry"("competitionId", "status");
CREATE INDEX "EditionEntry_teamId_idx" ON "EditionEntry"("teamId");
CREATE INDEX "EditionEntry_primaryGroupId_idx" ON "EditionEntry"("primaryGroupId");
CREATE UNIQUE INDEX "EditionEntry_competitionId_teamId_key"
  ON "EditionEntry"("competitionId", "teamId");

CREATE INDEX "RosterMembership_editionEntryId_status_idx"
  ON "RosterMembership"("editionEntryId", "status");
CREATE INDEX "RosterMembership_playerId_idx" ON "RosterMembership"("playerId");
CREATE UNIQUE INDEX "RosterMembership_editionEntryId_playerId_validFrom_key"
  ON "RosterMembership"("editionEntryId", "playerId", "validFrom");

CREATE UNIQUE INDEX "MatchSlot_matchId_side_key" ON "MatchSlot"("matchId", "side");
CREATE INDEX "MatchSlot_resolvedEntryId_idx" ON "MatchSlot"("resolvedEntryId");
CREATE INDEX "MatchSlot_sourceGroupId_idx" ON "MatchSlot"("sourceGroupId");
CREATE INDEX "MatchSlot_sourceMatchId_idx" ON "MatchSlot"("sourceMatchId");

CREATE INDEX "StageStanding_stageId_rank_idx" ON "StageStanding"("stageId", "rank");
CREATE INDEX "StageStanding_stageGroupId_rank_idx" ON "StageStanding"("stageGroupId", "rank");
CREATE INDEX "StageStanding_editionEntryId_idx" ON "StageStanding"("editionEntryId");
CREATE UNIQUE INDEX "StageStanding_stageId_stageGroupId_editionEntryId_key"
  ON "StageStanding"("stageId", "stageGroupId", "editionEntryId");
CREATE UNIQUE INDEX "StageStanding_stage_entry_key"
  ON "StageStanding"("stageId", "editionEntryId")
  WHERE "stageGroupId" IS NULL;

CREATE INDEX "Match_stageId_scheduledAt_idx" ON "Match"("stageId", "scheduledAt");
CREATE INDEX "Match_stageGroupId_scheduledAt_idx" ON "Match"("stageGroupId", "scheduledAt");
CREATE INDEX "Match_isSimulation_scheduledAt_idx" ON "Match"("isSimulation", "scheduledAt");
CREATE INDEX "Match_competitionId_resultQuality_scheduledAt_idx"
  ON "Match"("competitionId", "resultQuality", "scheduledAt");

CREATE UNIQUE INDEX "SourceSystem_key_key" ON "SourceSystem"("key");
CREATE INDEX "EditionSource_competitionId_enabled_idx" ON "EditionSource"("competitionId", "enabled");
CREATE INDEX "EditionSource_sourceSystemId_enabled_idx" ON "EditionSource"("sourceSystemId", "enabled");
CREATE UNIQUE INDEX "EditionSource_competitionId_sourceSystemId_externalId_key"
  ON "EditionSource"("competitionId", "sourceSystemId", "externalId");

CREATE INDEX "SourceEntityMapping_competitionId_entityType_idx"
  ON "SourceEntityMapping"("competitionId", "entityType");
CREATE INDEX "SourceEntityMapping_sourceSystemId_competitionId_entityType_internal_idx"
  ON "SourceEntityMapping"("sourceSystemId", "competitionId", "entityType", "internalEntityId");
CREATE UNIQUE INDEX "SourceEntityMapping_edition_external_key"
  ON "SourceEntityMapping"("sourceSystemId", "competitionId", "entityType", "externalId")
  WHERE "competitionId" IS NOT NULL;
CREATE UNIQUE INDEX "SourceEntityMapping_global_external_key"
  ON "SourceEntityMapping"("sourceSystemId", "entityType", "externalId")
  WHERE "competitionId" IS NULL;

CREATE INDEX "ImportRun_sourceSystemId_startedAt_idx" ON "ImportRun"("sourceSystemId", "startedAt");
CREATE INDEX "ImportRun_competitionId_startedAt_idx" ON "ImportRun"("competitionId", "startedAt");
CREATE INDEX "ImportRun_editionSourceId_startedAt_idx" ON "ImportRun"("editionSourceId", "startedAt");
CREATE INDEX "ImportRun_status_startedAt_idx" ON "ImportRun"("status", "startedAt");
CREATE INDEX "ImportIssue_importRunId_severity_idx" ON "ImportIssue"("importRunId", "severity");
CREATE INDEX "ImportIssue_status_createdAt_idx" ON "ImportIssue"("status", "createdAt");
CREATE UNIQUE INDEX "ImportMutation_importRunId_sequence_key" ON "ImportMutation"("importRunId", "sequence");
CREATE INDEX "ImportMutation_target_entityId_idx" ON "ImportMutation"("target", "entityId");

CREATE UNIQUE INDEX "SourceSnapshot_dedupeKey_key" ON "SourceSnapshot"("dedupeKey");
CREATE INDEX "SourceSnapshot_sourceSystemId_retrievedAt_idx"
  ON "SourceSnapshot"("sourceSystemId", "retrievedAt");
CREATE INDEX "SourceSnapshot_importRunId_idx" ON "SourceSnapshot"("importRunId");
CREATE INDEX "SourceSnapshot_competitionId_entityType_retrievedAt_idx"
  ON "SourceSnapshot"("competitionId", "entityType", "retrievedAt");
CREATE INDEX "SourceSnapshot_sourceSystemId_entityType_externalId_idx"
  ON "SourceSnapshot"("sourceSystemId", "entityType", "externalId");

CREATE INDEX "DataCoverage_competitionId_capability_state_idx"
  ON "DataCoverage"("competitionId", "capability", "state");
CREATE INDEX "DataCoverage_matchId_capability_idx" ON "DataCoverage"("matchId", "capability");
CREATE INDEX "DataCoverage_sourceSystemId_idx" ON "DataCoverage"("sourceSystemId");
CREATE UNIQUE INDEX "DataCoverage_edition_capability_key"
  ON "DataCoverage"("competitionId", "capability")
  WHERE "matchId" IS NULL;
CREATE UNIQUE INDEX "DataCoverage_match_capability_key"
  ON "DataCoverage"("competitionId", "matchId", "capability")
  WHERE "matchId" IS NOT NULL;

CREATE INDEX "PlayerAlias_normalizedAlias_idx" ON "PlayerAlias"("normalizedAlias");
CREATE INDEX "PlayerAlias_sourceSystemId_idx" ON "PlayerAlias"("sourceSystemId");
CREATE UNIQUE INDEX "PlayerAlias_playerId_normalizedAlias_key"
  ON "PlayerAlias"("playerId", "normalizedAlias");
CREATE INDEX "TeamAlias_normalizedAlias_idx" ON "TeamAlias"("normalizedAlias");
CREATE INDEX "TeamAlias_sourceSystemId_idx" ON "TeamAlias"("sourceSystemId");
CREATE UNIQUE INDEX "TeamAlias_teamId_normalizedAlias_key"
  ON "TeamAlias"("teamId", "normalizedAlias");

-- Foreign keys.
ALTER TABLE "Competition"
  ADD CONSTRAINT "Competition_seriesId_fkey"
  FOREIGN KEY ("seriesId") REFERENCES "CompetitionSeries"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Competition"
  ADD CONSTRAINT "Competition_rulesetId_fkey"
  FOREIGN KEY ("rulesetId") REFERENCES "Ruleset"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Stage"
  ADD CONSTRAINT "Stage_competitionId_fkey"
  FOREIGN KEY ("competitionId") REFERENCES "Competition"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StageGroup"
  ADD CONSTRAINT "StageGroup_stageId_fkey"
  FOREIGN KEY ("stageId") REFERENCES "Stage"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EditionEntry"
  ADD CONSTRAINT "EditionEntry_competitionId_fkey"
  FOREIGN KEY ("competitionId") REFERENCES "Competition"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EditionEntry"
  ADD CONSTRAINT "EditionEntry_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EditionEntry"
  ADD CONSTRAINT "EditionEntry_primaryGroupId_fkey"
  FOREIGN KEY ("primaryGroupId") REFERENCES "StageGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RosterMembership"
  ADD CONSTRAINT "RosterMembership_editionEntryId_fkey"
  FOREIGN KEY ("editionEntryId") REFERENCES "EditionEntry"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RosterMembership"
  ADD CONSTRAINT "RosterMembership_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "Player"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MatchSlot"
  ADD CONSTRAINT "MatchSlot_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "Match"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchSlot"
  ADD CONSTRAINT "MatchSlot_resolvedEntryId_fkey"
  FOREIGN KEY ("resolvedEntryId") REFERENCES "EditionEntry"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchSlot"
  ADD CONSTRAINT "MatchSlot_sourceGroupId_fkey"
  FOREIGN KEY ("sourceGroupId") REFERENCES "StageGroup"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchSlot"
  ADD CONSTRAINT "MatchSlot_sourceMatchId_fkey"
  FOREIGN KEY ("sourceMatchId") REFERENCES "Match"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StageStanding"
  ADD CONSTRAINT "StageStanding_stageId_fkey"
  FOREIGN KEY ("stageId") REFERENCES "Stage"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StageStanding"
  ADD CONSTRAINT "StageStanding_stageGroupId_fkey"
  FOREIGN KEY ("stageGroupId") REFERENCES "StageGroup"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StageStanding"
  ADD CONSTRAINT "StageStanding_editionEntryId_fkey"
  FOREIGN KEY ("editionEntryId") REFERENCES "EditionEntry"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Match"
  ADD CONSTRAINT "Match_stageId_fkey"
  FOREIGN KEY ("stageId") REFERENCES "Stage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Match"
  ADD CONSTRAINT "Match_stageGroupId_fkey"
  FOREIGN KEY ("stageGroupId") REFERENCES "StageGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EditionSource"
  ADD CONSTRAINT "EditionSource_competitionId_fkey"
  FOREIGN KEY ("competitionId") REFERENCES "Competition"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EditionSource"
  ADD CONSTRAINT "EditionSource_sourceSystemId_fkey"
  FOREIGN KEY ("sourceSystemId") REFERENCES "SourceSystem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SourceEntityMapping"
  ADD CONSTRAINT "SourceEntityMapping_sourceSystemId_fkey"
  FOREIGN KEY ("sourceSystemId") REFERENCES "SourceSystem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceEntityMapping"
  ADD CONSTRAINT "SourceEntityMapping_competitionId_fkey"
  FOREIGN KEY ("competitionId") REFERENCES "Competition"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ImportRun"
  ADD CONSTRAINT "ImportRun_sourceSystemId_fkey"
  FOREIGN KEY ("sourceSystemId") REFERENCES "SourceSystem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImportRun"
  ADD CONSTRAINT "ImportRun_competitionId_fkey"
  FOREIGN KEY ("competitionId") REFERENCES "Competition"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImportRun"
  ADD CONSTRAINT "ImportRun_editionSourceId_fkey"
  FOREIGN KEY ("editionSourceId") REFERENCES "EditionSource"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ImportIssue"
  ADD CONSTRAINT "ImportIssue_importRunId_fkey"
  FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportMutation"
  ADD CONSTRAINT "ImportMutation_importRunId_fkey"
  FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SourceSnapshot"
  ADD CONSTRAINT "SourceSnapshot_sourceSystemId_fkey"
  FOREIGN KEY ("sourceSystemId") REFERENCES "SourceSystem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceSnapshot"
  ADD CONSTRAINT "SourceSnapshot_importRunId_fkey"
  FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceSnapshot"
  ADD CONSTRAINT "SourceSnapshot_competitionId_fkey"
  FOREIGN KEY ("competitionId") REFERENCES "Competition"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DataCoverage"
  ADD CONSTRAINT "DataCoverage_competitionId_fkey"
  FOREIGN KEY ("competitionId") REFERENCES "Competition"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataCoverage"
  ADD CONSTRAINT "DataCoverage_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "Match"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataCoverage"
  ADD CONSTRAINT "DataCoverage_sourceSystemId_fkey"
  FOREIGN KEY ("sourceSystemId") REFERENCES "SourceSystem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlayerAlias"
  ADD CONSTRAINT "PlayerAlias_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "Player"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerAlias"
  ADD CONSTRAINT "PlayerAlias_sourceSystemId_fkey"
  FOREIGN KEY ("sourceSystemId") REFERENCES "SourceSystem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TeamAlias"
  ADD CONSTRAINT "TeamAlias_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamAlias"
  ADD CONSTRAINT "TeamAlias_sourceSystemId_fkey"
  FOREIGN KEY ("sourceSystemId") REFERENCES "SourceSystem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill stable competition series from the existing edition rows. A trailing
-- season is removed from the legacy display name so future editions share the
-- same parent series.
WITH legacy_editions AS (
  SELECT DISTINCT
    regexp_replace(btrim(c."name"), '\s+' || c."season"::text || '$', '', 'i') AS series_name
  FROM "Competition" c
), normalized_series AS (
  SELECT
    series_name,
    COALESCE(
      NULLIF(btrim(regexp_replace(lower(series_name), '[^a-z0-9]+', '-', 'g'), '-'), ''),
      'competition-' || substr(md5(series_name), 1, 12)
    ) AS series_slug
  FROM legacy_editions
)
INSERT INTO "CompetitionSeries" (
  "id", "slug", "name", "kind", "governingBody", "createdAt", "updatedAt"
)
SELECT
  'cp_series_' || md5(ns.series_slug),
  ns.series_slug,
  ns.series_name,
  'LEAGUE'::"CompetitionKind",
  CASE WHEN ns.series_name ILIKE '%super netball%' THEN 'Netball Australia' ELSE NULL END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM normalized_series ns
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "updatedAt" = CURRENT_TIMESTAMP;

WITH competition_series AS (
  SELECT
    c."id" AS competition_id,
    COALESCE(
      NULLIF(
        btrim(
          regexp_replace(
            lower(regexp_replace(btrim(c."name"), '\s+' || c."season"::text || '$', '', 'i')),
            '[^a-z0-9]+',
            '-',
            'g'
          ),
          '-'
        ),
        ''
      ),
      'competition-' || substr(
        md5(regexp_replace(btrim(c."name"), '\s+' || c."season"::text || '$', '', 'i')),
        1,
        12
      )
    ) AS series_slug
  FROM "Competition" c
)
UPDATE "Competition" c
SET
  "seriesId" = cs."id",
  "slug" = c."season"::text,
  "label" = COALESCE(c."label", c."season"::text),
  "publicationStatus" = 'PUBLISHED'::"PublicationStatus",
  "publishedAt" = COALESCE(c."publishedAt", c."seasonStart", CURRENT_TIMESTAMP)
FROM competition_series normalized
JOIN "CompetitionSeries" cs ON cs."slug" = normalized.series_slug
WHERE c."id" = normalized.competition_id;

INSERT INTO "Ruleset" (
  "id",
  "slug",
  "name",
  "periodCount",
  "regulationPeriodMinutes",
  "extraTimePolicy",
  "scoringModel",
  "standingsStrategyKey",
  "superShotsEnabled",
  "config",
  "createdAt",
  "updatedAt"
)
SELECT DISTINCT
  'cp_ruleset_' || md5(cs."id"),
  cs."slug" || '-standard',
  cs."name" || ' Rules',
  4,
  15,
  'COMPETITION_DEFINED',
  CASE WHEN cs."name" ILIKE '%super netball%' THEN 'STANDARD_WITH_SUPER_SHOT' ELSE 'STANDARD' END,
  CASE WHEN cs."name" ILIKE '%super netball%' THEN 'SSN_4_2_0' ELSE 'STANDARD' END,
  cs."name" ILIKE '%super netball%',
  NULL::JSONB,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "CompetitionSeries" cs
JOIN "Competition" c ON c."seriesId" = cs."id"
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "periodCount" = EXCLUDED."periodCount",
  "regulationPeriodMinutes" = EXCLUDED."regulationPeriodMinutes",
  "extraTimePolicy" = EXCLUDED."extraTimePolicy",
  "scoringModel" = EXCLUDED."scoringModel",
  "standingsStrategyKey" = EXCLUDED."standingsStrategyKey",
  "superShotsEnabled" = EXCLUDED."superShotsEnabled",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "Competition" c
SET "rulesetId" = r."id"
FROM "CompetitionSeries" cs
JOIN "Ruleset" r ON r."slug" = cs."slug" || '-standard'
WHERE c."seriesId" = cs."id";

-- Every legacy edition receives regular-season and finals stages. Match stage
-- assignment uses the provider source/final code, never a round-number cutoff.
INSERT INTO "Stage" (
  "id", "competitionId", "slug", "name", "type", "sequence", "startsAt", "endsAt", "isPublished"
)
SELECT
  'cp_stage_regular_' || md5(c."id"),
  c."id",
  'regular-season',
  'Regular Season',
  'REGULAR_SEASON'::"StageType",
  0,
  c."seasonStart",
  c."seasonEnd",
  true
FROM "Competition" c
ON CONFLICT ("competitionId", "slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "type" = EXCLUDED."type",
  "sequence" = EXCLUDED."sequence",
  "startsAt" = EXCLUDED."startsAt",
  "endsAt" = EXCLUDED."endsAt",
  "isPublished" = EXCLUDED."isPublished";

INSERT INTO "Stage" (
  "id", "competitionId", "slug", "name", "type", "sequence", "startsAt", "endsAt", "isPublished"
)
SELECT
  'cp_stage_finals_' || md5(c."id"),
  c."id",
  'finals',
  'Finals',
  'FINALS'::"StageType",
  1,
  NULL::TIMESTAMP(3),
  c."seasonEnd",
  true
FROM "Competition" c
ON CONFLICT ("competitionId", "slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "type" = EXCLUDED."type",
  "sequence" = EXCLUDED."sequence",
  "endsAt" = EXCLUDED."endsAt",
  "isPublished" = EXCLUDED."isPublished";

UPDATE "Match" m
SET
  "stageId" = CASE
    WHEN m."finalCode" IS NOT NULL
      OR (
        m."sourceCompetitionId" IS NOT NULL
        AND m."sourceCompetitionId" <> c."championDataId"
      )
    THEN finals."id"
    ELSE regular."id"
  END,
  "roundLabel" = COALESCE(m."roundLabel", 'Round ' || m."round"::text),
  "isSimulation" = m."isSimulation" OR m."round" = 99,
  "resultQuality" = CASE
    WHEN m."status" = 'COMPLETED'::"MatchStatus" THEN 'OFFICIAL_FINAL'::"ResultQualityStatus"
    WHEN m."status" = 'LIVE'::"MatchStatus" THEN 'PROVISIONAL'::"ResultQualityStatus"
    ELSE m."resultQuality"
  END
FROM "Competition" c
JOIN "Stage" regular
  ON regular."competitionId" = c."id" AND regular."slug" = 'regular-season'
JOIN "Stage" finals
  ON finals."competitionId" = c."id" AND finals."slug" = 'finals'
WHERE m."competitionId" = c."id";

WITH latest_poll AS (
  SELECT pl."cdMatchId", max(pl."polledAt") AS retrieved_at
  FROM "PollLog" pl
  WHERE pl."cdMatchId" IS NOT NULL
  GROUP BY pl."cdMatchId"
)
UPDATE "Match" m
SET "sourceRetrievedAt" = lp.retrieved_at
FROM latest_poll lp
WHERE m."championDataMatchId" = lp."cdMatchId";

-- Canonical edition entries and player memberships retain all legacy Team and
-- Player IDs. Dates are stable across reruns, including editions without a
-- recorded start date.
INSERT INTO "EditionEntry" (
  "id", "competitionId", "teamId", "status", "displayName", "enteredAt"
)
SELECT
  'cp_entry_' || md5(t."competitionId" || ':' || t."id"),
  t."competitionId",
  t."id",
  'ACTIVE'::"EditionEntryStatus",
  t."name",
  c."seasonStart"
FROM "Team" t
JOIN "Competition" c ON c."id" = t."competitionId"
ON CONFLICT ("competitionId", "teamId") DO UPDATE SET
  "displayName" = EXCLUDED."displayName";

INSERT INTO "RosterMembership" (
  "id",
  "editionEntryId",
  "playerId",
  "status",
  "validFrom",
  "designatedPosition",
  "isCaptain"
)
SELECT
  'cp_roster_' || md5(ee."id" || ':' || p."id"),
  ee."id",
  p."id",
  'ACTIVE'::"RosterMembershipStatus",
  COALESCE(c."seasonStart", TIMESTAMP '1970-01-01 00:00:00'),
  p."position",
  false
FROM "Player" p
JOIN "Team" t ON t."id" = p."teamId"
JOIN "Competition" c ON c."id" = t."competitionId"
JOIN "EditionEntry" ee
  ON ee."competitionId" = t."competitionId" AND ee."teamId" = t."id"
ON CONFLICT ("editionEntryId", "playerId", "validFrom") DO UPDATE SET
  "status" = EXCLUDED."status",
  "designatedPosition" = EXCLUDED."designatedPosition";

-- Existing matches always have concrete legacy home/away teams, so CP-01 can
-- populate exactly two resolved TEAM slots while leaving those legacy columns
-- required for old-release compatibility.
WITH legacy_sides AS (
  SELECT m."id" AS match_id, m."competitionId" AS competition_id, 'A'::"MatchSide" AS side, m."homeTeamId" AS team_id
  FROM "Match" m
  UNION ALL
  SELECT m."id", m."competitionId", 'B'::"MatchSide", m."awayTeamId"
  FROM "Match" m
)
INSERT INTO "MatchSlot" (
  "id", "matchId", "side", "sourceType", "resolvedEntryId", "sourceLabel", "resolvedAt"
)
SELECT
  'cp_slot_' || md5(ls.match_id || ':' || ls.side::text),
  ls.match_id,
  ls.side,
  'TEAM'::"MatchSlotSourceType",
  ee."id",
  'legacy-home-away-compatibility',
  CURRENT_TIMESTAMP
FROM legacy_sides ls
JOIN "EditionEntry" ee
  ON ee."competitionId" = ls.competition_id AND ee."teamId" = ls.team_id
ON CONFLICT ("matchId", "side") DO UPDATE SET
  "sourceType" = EXCLUDED."sourceType",
  "resolvedEntryId" = EXCLUDED."resolvedEntryId",
  "sourceGroupId" = NULL,
  "sourceRank" = NULL,
  "sourceMatchId" = NULL,
  "sourceLabel" = EXCLUDED."sourceLabel",
  "resolvedAt" = EXCLUDED."resolvedAt";

INSERT INTO "StageStanding" (
  "id",
  "stageId",
  "stageGroupId",
  "editionEntryId",
  "rank",
  "played",
  "wins",
  "losses",
  "draws",
  "goalsFor",
  "goalsAgainst",
  "goalPercentage",
  "points",
  "updatedAt"
)
SELECT
  'cp_stage_standing_' || md5(s."id" || ':' || ee."id"),
  s."id",
  NULL::TEXT,
  ee."id",
  legacy."rank",
  legacy."played",
  legacy."wins",
  legacy."losses",
  legacy."draws",
  legacy."goalsFor",
  legacy."goalsAgainst",
  legacy."goalPercentage",
  legacy."points",
  legacy."updatedAt"
FROM "Standing" legacy
JOIN "Stage" s
  ON s."competitionId" = legacy."competitionId" AND s."slug" = 'regular-season'
JOIN "EditionEntry" ee
  ON ee."competitionId" = legacy."competitionId" AND ee."teamId" = legacy."teamId"
ON CONFLICT ("stageId", "editionEntryId") WHERE "stageGroupId" IS NULL DO UPDATE SET
  "rank" = EXCLUDED."rank",
  "played" = EXCLUDED."played",
  "wins" = EXCLUDED."wins",
  "losses" = EXCLUDED."losses",
  "draws" = EXCLUDED."draws",
  "goalsFor" = EXCLUDED."goalsFor",
  "goalsAgainst" = EXCLUDED."goalsAgainst",
  "goalPercentage" = EXCLUDED."goalPercentage",
  "points" = EXCLUDED."points",
  "updatedAt" = EXCLUDED."updatedAt";

-- Provider/source backfill. Champion Data's 12949 regular-season and 12950
-- finals feeds are represented as two EditionSource rows for the same current
-- SSN edition. The union also discovers any additional existing source IDs.
INSERT INTO "SourceSystem" (
  "id",
  "key",
  "name",
  "kind",
  "baseUrl",
  "active",
  "rawPayloadStorageAllowed",
  "createdAt",
  "updatedAt"
)
SELECT
  'cp_source_' || md5('champion-data'),
  'champion-data',
  'Champion Data',
  'OFFICIAL_FEED'::"SourceSystemKind",
  NULL::TEXT,
  true,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Competition")
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "kind" = EXCLUDED."kind",
  "active" = EXCLUDED."active",
  "updatedAt" = CURRENT_TIMESTAMP;

WITH discovered_source_ids AS (
  SELECT c."id" AS competition_id, c."championDataId" AS external_id
  FROM "Competition" c
  UNION
  SELECT m."competitionId", m."sourceCompetitionId"
  FROM "Match" m
  WHERE m."sourceCompetitionId" IS NOT NULL
  UNION
  -- The current SSN edition is known to use a separate finals feed. Keep this
  -- external contract explicit even before a finals fixture has been ingested.
  SELECT c."id", 12950
  FROM "Competition" c
  WHERE c."championDataId" = 12949
), source_rows AS (
  SELECT
    dsi.competition_id,
    ss."id" AS source_system_id,
    dsi.external_id::text AS external_id,
    CASE WHEN dsi.external_id = c."championDataId" THEN 0 ELSE 1 END AS priority
  FROM discovered_source_ids dsi
  JOIN "Competition" c ON c."id" = dsi.competition_id
  CROSS JOIN "SourceSystem" ss
  WHERE ss."key" = 'champion-data'
)
INSERT INTO "EditionSource" (
  "id",
  "competitionId",
  "sourceSystemId",
  "externalId",
  "enabled",
  "priority",
  "createdAt",
  "updatedAt"
)
SELECT
  'cp_edition_source_' || md5(sr.competition_id || ':' || sr.source_system_id || ':' || sr.external_id),
  sr.competition_id,
  sr.source_system_id,
  sr.external_id,
  true,
  sr.priority,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM source_rows sr
ON CONFLICT ("competitionId", "sourceSystemId", "externalId") DO UPDATE SET
  "enabled" = EXCLUDED."enabled",
  "priority" = EXCLUDED."priority",
  "updatedAt" = CURRENT_TIMESTAMP;

-- Both Champion Data competition feeds map to the same canonical edition.
INSERT INTO "SourceEntityMapping" (
  "id",
  "sourceSystemId",
  "competitionId",
  "entityType",
  "externalId",
  "internalEntityId",
  "verifiedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'cp_mapping_' || md5(es."sourceSystemId" || ':' || es."competitionId" || ':COMPETITION_EDITION:' || es."externalId"),
  es."sourceSystemId",
  es."competitionId",
  'COMPETITION_EDITION'::"SourceEntityType",
  es."externalId",
  es."competitionId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "EditionSource" es
ON CONFLICT ("sourceSystemId", "competitionId", "entityType", "externalId")
  WHERE "competitionId" IS NOT NULL DO UPDATE SET
  "internalEntityId" = EXCLUDED."internalEntityId",
  "verifiedAt" = EXCLUDED."verifiedAt",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "SourceEntityMapping" (
  "id", "sourceSystemId", "competitionId", "entityType", "externalId", "internalEntityId", "verifiedAt", "createdAt", "updatedAt"
)
SELECT
  'cp_mapping_' || md5(ss."id" || ':' || t."competitionId" || ':TEAM:' || t."championDataTeamId"::text),
  ss."id",
  t."competitionId",
  'TEAM'::"SourceEntityType",
  t."championDataTeamId"::text,
  t."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Team" t
CROSS JOIN "SourceSystem" ss
WHERE ss."key" = 'champion-data' AND t."championDataTeamId" IS NOT NULL
ON CONFLICT ("sourceSystemId", "competitionId", "entityType", "externalId")
  WHERE "competitionId" IS NOT NULL DO UPDATE SET
  "internalEntityId" = EXCLUDED."internalEntityId",
  "verifiedAt" = EXCLUDED."verifiedAt",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "SourceEntityMapping" (
  "id", "sourceSystemId", "competitionId", "entityType", "externalId", "internalEntityId", "verifiedAt", "createdAt", "updatedAt"
)
SELECT
  'cp_mapping_' || md5(ss."id" || ':' || t."competitionId" || ':PLAYER:' || p."championDataPlayerId"::text),
  ss."id",
  t."competitionId",
  'PLAYER'::"SourceEntityType",
  p."championDataPlayerId"::text,
  p."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Player" p
JOIN "Team" t ON t."id" = p."teamId"
CROSS JOIN "SourceSystem" ss
WHERE ss."key" = 'champion-data' AND p."championDataPlayerId" IS NOT NULL
ON CONFLICT ("sourceSystemId", "competitionId", "entityType", "externalId")
  WHERE "competitionId" IS NOT NULL DO UPDATE SET
  "internalEntityId" = EXCLUDED."internalEntityId",
  "verifiedAt" = EXCLUDED."verifiedAt",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "SourceEntityMapping" (
  "id", "sourceSystemId", "competitionId", "entityType", "externalId", "internalEntityId", "verifiedAt", "createdAt", "updatedAt"
)
SELECT
  'cp_mapping_' || md5(ss."id" || ':' || m."competitionId" || ':MATCH:' || m."championDataMatchId"::text),
  ss."id",
  m."competitionId",
  'MATCH'::"SourceEntityType",
  m."championDataMatchId"::text,
  m."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Match" m
CROSS JOIN "SourceSystem" ss
WHERE ss."key" = 'champion-data' AND m."championDataMatchId" IS NOT NULL
ON CONFLICT ("sourceSystemId", "competitionId", "entityType", "externalId")
  WHERE "competitionId" IS NOT NULL DO UPDATE SET
  "internalEntityId" = EXCLUDED."internalEntityId",
  "verifiedAt" = EXCLUDED."verifiedAt",
  "updatedAt" = CURRENT_TIMESTAMP;

-- Canonical aliases make identity resolution independent of display names.
WITH team_names AS (
  SELECT t."id" AS team_id, t."name" AS alias, true AS is_primary
  FROM "Team" t
  UNION ALL
  SELECT t."id", t."abbreviation", false
  FROM "Team" t
  WHERE btrim(t."abbreviation") <> '' AND lower(btrim(t."abbreviation")) <> lower(btrim(t."name"))
), normalized AS (
  SELECT
    team_id,
    alias,
    is_primary,
    btrim(regexp_replace(lower(btrim(alias)), '[^a-z0-9]+', ' ', 'g')) AS normalized_alias
  FROM team_names
)
INSERT INTO "TeamAlias" (
  "id", "teamId", "alias", "normalizedAlias", "isPrimary", "createdAt"
)
SELECT
  'cp_team_alias_' || md5(n.team_id || ':' || n.normalized_alias),
  n.team_id,
  n.alias,
  n.normalized_alias,
  n.is_primary,
  CURRENT_TIMESTAMP
FROM normalized n
WHERE n.normalized_alias <> ''
ON CONFLICT ("teamId", "normalizedAlias") DO UPDATE SET
  "alias" = EXCLUDED."alias",
  "isPrimary" = "TeamAlias"."isPrimary" OR EXCLUDED."isPrimary";

WITH normalized AS (
  SELECT
    p."id" AS player_id,
    p."name" AS alias,
    btrim(regexp_replace(lower(btrim(p."name")), '[^a-z0-9]+', ' ', 'g')) AS normalized_alias
  FROM "Player" p
)
INSERT INTO "PlayerAlias" (
  "id", "playerId", "alias", "normalizedAlias", "isPrimary", "createdAt"
)
SELECT
  'cp_player_alias_' || md5(n.player_id || ':' || n.normalized_alias),
  n.player_id,
  n.alias,
  n.normalized_alias,
  true,
  CURRENT_TIMESTAMP
FROM normalized n
WHERE n.normalized_alias <> ''
ON CONFLICT ("playerId", "normalizedAlias") DO UPDATE SET
  "alias" = EXCLUDED."alias",
  "isPrimary" = true;

-- Edition-level coverage is explicitly unique via a partial index; nullable
-- compound uniqueness is intentionally avoided. Presence-based PARTIAL states
-- are conservative because this migration cannot prove historical completeness.
WITH capabilities(capability) AS (
  VALUES
    ('FINAL_SCORE'::"DataCapability"),
    ('PERIOD_SCORES'::"DataCapability"),
    ('TEAM_BOX_SCORE'::"DataCapability"),
    ('PLAYER_BOX_SCORE'::"DataCapability"),
    ('SCORE_FLOW'::"DataCapability"),
    ('MATCH_EVENTS'::"DataCapability"),
    ('SUBSTITUTIONS'::"DataCapability"),
    ('NET_POINTS'::"DataCapability"),
    ('SUPER_SHOTS'::"DataCapability"),
    ('LINEUPS'::"DataCapability")
), coverage_rows AS (
  SELECT
    c."id" AS competition_id,
    cap.capability,
    CASE cap.capability
      WHEN 'FINAL_SCORE'::"DataCapability" THEN
        CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM "Match" m
            WHERE m."competitionId" = c."id" AND m."isSimulation" = false
          ) THEN 'UNAVAILABLE'::"CoverageState"
          WHEN NOT EXISTS (
            SELECT 1 FROM "Match" m
            WHERE m."competitionId" = c."id"
              AND m."isSimulation" = false
              AND m."status" <> 'COMPLETED'::"MatchStatus"
          ) THEN 'AVAILABLE'::"CoverageState"
          WHEN EXISTS (
            SELECT 1 FROM "Match" m
            WHERE m."competitionId" = c."id"
              AND m."isSimulation" = false
              AND m."status" = 'COMPLETED'::"MatchStatus"
          ) THEN 'PARTIAL'::"CoverageState"
          ELSE 'PROVISIONAL'::"CoverageState"
        END
      WHEN 'PERIOD_SCORES'::"DataCapability" THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM "MatchQuarter" q JOIN "Match" m ON m."id" = q."matchId"
          WHERE m."competitionId" = c."id" AND m."isSimulation" = false
        ) THEN 'PARTIAL'::"CoverageState" ELSE 'UNAVAILABLE'::"CoverageState" END
      WHEN 'TEAM_BOX_SCORE'::"DataCapability" THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM "TeamMatchStats" s JOIN "Match" m ON m."id" = s."matchId"
          WHERE m."competitionId" = c."id" AND m."isSimulation" = false
        ) THEN 'PARTIAL'::"CoverageState" ELSE 'UNAVAILABLE'::"CoverageState" END
      WHEN 'PLAYER_BOX_SCORE'::"DataCapability" THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM "PlayerMatchStats" s JOIN "Match" m ON m."id" = s."matchId"
          WHERE m."competitionId" = c."id" AND m."isSimulation" = false
        ) THEN 'PARTIAL'::"CoverageState" ELSE 'UNAVAILABLE'::"CoverageState" END
      WHEN 'SCORE_FLOW'::"DataCapability" THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM "ScoreFlow" f JOIN "Match" m ON m."id" = f."matchId"
          WHERE m."competitionId" = c."id" AND m."isSimulation" = false
        ) THEN 'PARTIAL'::"CoverageState" ELSE 'UNAVAILABLE'::"CoverageState" END
      WHEN 'MATCH_EVENTS'::"DataCapability" THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM "MatchEvent" e JOIN "Match" m ON m."id" = e."matchId"
          WHERE m."competitionId" = c."id" AND m."isSimulation" = false
        ) THEN 'PARTIAL'::"CoverageState" ELSE 'UNAVAILABLE'::"CoverageState" END
      WHEN 'NET_POINTS'::"DataCapability" THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM "PlayerMatchStats" s JOIN "Match" m ON m."id" = s."matchId"
          WHERE m."competitionId" = c."id" AND m."isSimulation" = false AND s."netPoints" <> 0
        ) THEN 'PARTIAL'::"CoverageState" ELSE 'UNAVAILABLE'::"CoverageState" END
      WHEN 'SUPER_SHOTS'::"DataCapability" THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM "PlayerMatchStats" s JOIN "Match" m ON m."id" = s."matchId"
          WHERE m."competitionId" = c."id"
            AND m."isSimulation" = false
            AND (s."attempt2" <> 0 OR s."goal2" <> 0)
        ) THEN 'PARTIAL'::"CoverageState"
        WHEN EXISTS (
          SELECT 1 FROM "Ruleset" r
          WHERE r."id" = c."rulesetId" AND r."superShotsEnabled" = true
        ) THEN 'PROVISIONAL'::"CoverageState"
        ELSE 'UNAVAILABLE'::"CoverageState" END
      ELSE 'UNAVAILABLE'::"CoverageState"
    END AS state
  FROM "Competition" c
  CROSS JOIN capabilities cap
)
INSERT INTO "DataCoverage" (
  "id", "competitionId", "matchId", "sourceSystemId", "capability", "state", "observedAt", "notes"
)
SELECT
  'cp_coverage_' || md5(cr.competition_id || ':edition:' || cr.capability::text),
  cr.competition_id,
  NULL::TEXT,
  ss."id",
  cr.capability,
  cr.state,
  CURRENT_TIMESTAMP,
  'Backfilled conservatively from legacy CentrePass data presence'
FROM coverage_rows cr
LEFT JOIN "SourceSystem" ss ON ss."key" = 'champion-data'
ON CONFLICT ("competitionId", "capability") WHERE "matchId" IS NULL DO UPDATE SET
  "sourceSystemId" = EXCLUDED."sourceSystemId",
  "state" = EXCLUDED."state",
  "observedAt" = EXCLUDED."observedAt",
  "notes" = EXCLUDED."notes";

-- Fail closed if any legacy record was not given its canonical relationship.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Competition" c
    WHERE c."seriesId" IS NULL OR c."rulesetId" IS NULL OR c."slug" IS NULL
  ) THEN
    RAISE EXCEPTION 'CP-01 backfill incomplete: competition series/ruleset/slug missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Team" t
    LEFT JOIN "EditionEntry" ee
      ON ee."competitionId" = t."competitionId" AND ee."teamId" = t."id"
    WHERE ee."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'CP-01 backfill incomplete: team without edition entry';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Player" p
    JOIN "Team" t ON t."id" = p."teamId"
    JOIN "EditionEntry" ee
      ON ee."competitionId" = t."competitionId" AND ee."teamId" = t."id"
    LEFT JOIN "RosterMembership" rm
      ON rm."editionEntryId" = ee."id" AND rm."playerId" = p."id"
    WHERE rm."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'CP-01 backfill incomplete: player without roster membership';
  END IF;

  IF EXISTS (SELECT 1 FROM "Match" m WHERE m."stageId" IS NULL) THEN
    RAISE EXCEPTION 'CP-01 backfill incomplete: match without stage';
  END IF;

  IF EXISTS (
    SELECT m."id"
    FROM "Match" m
    LEFT JOIN "MatchSlot" ms ON ms."matchId" = m."id"
    GROUP BY m."id"
    HAVING count(ms."id") <> 2
      OR count(*) FILTER (
        WHERE ms."sourceType" = 'TEAM'::"MatchSlotSourceType"
          AND ms."resolvedEntryId" IS NOT NULL
      ) <> 2
  ) THEN
    RAISE EXCEPTION 'CP-01 backfill incomplete: match does not have exactly two resolved TEAM slots';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Match" m
    JOIN "Competition" c ON c."id" = m."competitionId"
    JOIN "Stage" s ON s."id" = m."stageId"
    WHERE (
      m."finalCode" IS NOT NULL
      OR (m."sourceCompetitionId" IS NOT NULL AND m."sourceCompetitionId" <> c."championDataId")
    ) AND s."type" <> 'FINALS'::"StageType"
  ) THEN
    RAISE EXCEPTION 'CP-01 backfill incomplete: finals match assigned outside finals stage';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Match" m
    JOIN "Competition" c ON c."id" = m."competitionId"
    JOIN "Stage" s ON s."id" = m."stageId"
    WHERE m."finalCode" IS NULL
      AND (m."sourceCompetitionId" IS NULL OR m."sourceCompetitionId" = c."championDataId")
      AND s."type" <> 'REGULAR_SEASON'::"StageType"
  ) THEN
    RAISE EXCEPTION 'CP-01 backfill incomplete: regular match assigned outside regular-season stage';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Match" m
    WHERE m."round" = 99 AND m."isSimulation" = false
  ) THEN
    RAISE EXCEPTION 'CP-01 backfill incomplete: round-99 simulation not flagged';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Standing" legacy
    JOIN "Stage" s
      ON s."competitionId" = legacy."competitionId" AND s."slug" = 'regular-season'
    JOIN "EditionEntry" ee
      ON ee."competitionId" = legacy."competitionId" AND ee."teamId" = legacy."teamId"
    LEFT JOIN "StageStanding" canonical
      ON canonical."stageId" = s."id"
      AND canonical."stageGroupId" IS NULL
      AND canonical."editionEntryId" = ee."id"
    WHERE canonical."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'CP-01 backfill incomplete: legacy standing without stage standing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Competition" c
    WHERE c."championDataId" = 12949
      AND (
        SELECT count(DISTINCT es."externalId")
        FROM "EditionSource" es
        JOIN "SourceSystem" ss ON ss."id" = es."sourceSystemId"
        WHERE es."competitionId" = c."id"
          AND ss."key" = 'champion-data'
          AND es."externalId" IN ('12949', '12950')
      ) <> 2
  ) THEN
    RAISE EXCEPTION 'CP-01 backfill incomplete: SSN edition must include Champion Data 12949 and 12950';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Team" t
    CROSS JOIN "SourceSystem" ss
    LEFT JOIN "SourceEntityMapping" sem
      ON sem."sourceSystemId" = ss."id"
      AND sem."competitionId" = t."competitionId"
      AND sem."entityType" = 'TEAM'::"SourceEntityType"
      AND sem."externalId" = t."championDataTeamId"::text
    WHERE ss."key" = 'champion-data'
      AND t."championDataTeamId" IS NOT NULL
      AND sem."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'CP-01 backfill incomplete: Champion Data team mapping missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Player" p
    JOIN "Team" t ON t."id" = p."teamId"
    CROSS JOIN "SourceSystem" ss
    LEFT JOIN "SourceEntityMapping" sem
      ON sem."sourceSystemId" = ss."id"
      AND sem."competitionId" = t."competitionId"
      AND sem."entityType" = 'PLAYER'::"SourceEntityType"
      AND sem."externalId" = p."championDataPlayerId"::text
    WHERE ss."key" = 'champion-data'
      AND p."championDataPlayerId" IS NOT NULL
      AND sem."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'CP-01 backfill incomplete: Champion Data player mapping missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Match" m
    CROSS JOIN "SourceSystem" ss
    LEFT JOIN "SourceEntityMapping" sem
      ON sem."sourceSystemId" = ss."id"
      AND sem."competitionId" = m."competitionId"
      AND sem."entityType" = 'MATCH'::"SourceEntityType"
      AND sem."externalId" = m."championDataMatchId"::text
    WHERE ss."key" = 'champion-data'
      AND m."championDataMatchId" IS NOT NULL
      AND sem."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'CP-01 backfill incomplete: Champion Data match mapping missing';
  END IF;

  IF EXISTS (
    SELECT c."id"
    FROM "Competition" c
    LEFT JOIN "DataCoverage" dc
      ON dc."competitionId" = c."id" AND dc."matchId" IS NULL
    GROUP BY c."id"
    HAVING count(dc."id") <> 10
  ) THEN
    RAISE EXCEPTION 'CP-01 backfill incomplete: edition capability coverage set missing';
  END IF;
END $$;

-- Rolling-deploy compatibility. Render applies migrations before replacing the
-- running worker, so the previous release can continue writing legacy Match
-- columns for a short window. These triggers keep the canonical fields, slots,
-- edition source, and edition-scoped mapping complete during that window and
-- remain a defensive bridge for older maintenance scripts.
CREATE FUNCTION cp_prepare_legacy_match_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW."stageId" IS NULL THEN
    SELECT s."id"
    INTO NEW."stageId"
    FROM "Stage" s
    JOIN "Competition" c ON c."id" = NEW."competitionId"
    WHERE s."competitionId" = NEW."competitionId"
      AND s."slug" = CASE
        WHEN NEW."finalCode" IS NOT NULL
          OR (
            NEW."sourceCompetitionId" IS NOT NULL
            AND NEW."sourceCompetitionId" <> c."championDataId"
          )
        THEN 'finals'
        ELSE 'regular-season'
      END
    LIMIT 1;
  END IF;

  IF NEW."roundLabel" IS NULL AND NEW."round" IS NOT NULL THEN
    NEW."roundLabel" := 'Round ' || NEW."round"::text;
  END IF;
  NEW."isSimulation" := NEW."isSimulation" OR COALESCE(NEW."round" = 99, false);

  IF NEW."status" = 'COMPLETED'::"MatchStatus"
    AND NEW."resultQuality" IN (
      'UNKNOWN'::"ResultQualityStatus",
      'PROVISIONAL'::"ResultQualityStatus"
    )
  THEN
    NEW."resultQuality" := 'UNOFFICIAL_FINAL'::"ResultQualityStatus";
  ELSIF NEW."status" = 'LIVE'::"MatchStatus"
    AND NEW."resultQuality" = 'UNKNOWN'::"ResultQualityStatus"
  THEN
    NEW."resultQuality" := 'PROVISIONAL'::"ResultQualityStatus";
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Match_prepare_legacy_write"
BEFORE INSERT OR UPDATE OF
  "competitionId",
  "round",
  "finalCode",
  "sourceCompetitionId",
  "status",
  "stageId",
  "roundLabel",
  "isSimulation",
  "resultQuality"
ON "Match"
FOR EACH ROW
EXECUTE FUNCTION cp_prepare_legacy_match_write();

CREATE FUNCTION cp_sync_legacy_match_foundation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  source_system_id TEXT;
  source_external_id TEXT;
BEGIN
  -- Use legacy Team.competitionId only to bootstrap current-edition entries.
  -- Pre-created canonical entries remain valid when a Team spans editions.
  INSERT INTO "EditionEntry" (
    "id", "competitionId", "teamId", "status", "displayName", "enteredAt"
  )
  SELECT
    'cp_entry_' || md5(t."competitionId" || ':' || t."id"),
    t."competitionId",
    t."id",
    'ACTIVE'::"EditionEntryStatus",
    t."name",
    c."seasonStart"
  FROM "Team" t
  JOIN "Competition" c ON c."id" = t."competitionId"
  WHERE t."id" IN (NEW."homeTeamId", NEW."awayTeamId")
    AND t."competitionId" = NEW."competitionId"
  ON CONFLICT ("competitionId", "teamId") DO UPDATE SET
    "displayName" = EXCLUDED."displayName";

  INSERT INTO "MatchSlot" (
    "id", "matchId", "side", "sourceType", "resolvedEntryId", "sourceLabel", "resolvedAt"
  )
  SELECT
    'cp_slot_' || md5(NEW."id" || ':A'),
    NEW."id",
    'A'::"MatchSide",
    'TEAM'::"MatchSlotSourceType",
    ee."id",
    'legacy-home-away-compatibility',
    CURRENT_TIMESTAMP
  FROM "EditionEntry" ee
  WHERE ee."competitionId" = NEW."competitionId"
    AND ee."teamId" = NEW."homeTeamId"
  ON CONFLICT ("matchId", "side") DO UPDATE SET
    "resolvedEntryId" = EXCLUDED."resolvedEntryId",
    "resolvedAt" = EXCLUDED."resolvedAt"
  WHERE "MatchSlot"."sourceType" = 'TEAM'::"MatchSlotSourceType"
    AND "MatchSlot"."sourceLabel" = 'legacy-home-away-compatibility'
    AND CASE
      WHEN TG_OP = 'INSERT' THEN true
      ELSE NEW."competitionId" IS DISTINCT FROM OLD."competitionId"
        OR NEW."homeTeamId" IS DISTINCT FROM OLD."homeTeamId"
    END;

  INSERT INTO "MatchSlot" (
    "id", "matchId", "side", "sourceType", "resolvedEntryId", "sourceLabel", "resolvedAt"
  )
  SELECT
    'cp_slot_' || md5(NEW."id" || ':B'),
    NEW."id",
    'B'::"MatchSide",
    'TEAM'::"MatchSlotSourceType",
    ee."id",
    'legacy-home-away-compatibility',
    CURRENT_TIMESTAMP
  FROM "EditionEntry" ee
  WHERE ee."competitionId" = NEW."competitionId"
    AND ee."teamId" = NEW."awayTeamId"
  ON CONFLICT ("matchId", "side") DO UPDATE SET
    "resolvedEntryId" = EXCLUDED."resolvedEntryId",
    "resolvedAt" = EXCLUDED."resolvedAt"
  WHERE "MatchSlot"."sourceType" = 'TEAM'::"MatchSlotSourceType"
    AND "MatchSlot"."sourceLabel" = 'legacy-home-away-compatibility'
    AND CASE
      WHEN TG_OP = 'INSERT' THEN true
      ELSE NEW."competitionId" IS DISTINCT FROM OLD."competitionId"
        OR NEW."awayTeamId" IS DISTINCT FROM OLD."awayTeamId"
    END;

  IF NEW."championDataMatchId" IS NOT NULL THEN
    INSERT INTO "SourceSystem" (
      "id", "key", "name", "kind", "active", "rawPayloadStorageAllowed", "createdAt", "updatedAt"
    )
    VALUES (
      'cp_source_' || md5('champion-data'),
      'champion-data',
      'Champion Data',
      'OFFICIAL_FEED'::"SourceSystemKind",
      true,
      false,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("key") DO UPDATE SET
      "active" = true,
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "id" INTO source_system_id;

    SELECT COALESCE(NEW."sourceCompetitionId", c."championDataId")::text
    INTO source_external_id
    FROM "Competition" c
    WHERE c."id" = NEW."competitionId";

    INSERT INTO "EditionSource" (
      "id", "competitionId", "sourceSystemId", "externalId", "enabled", "priority", "lastSyncedAt", "createdAt", "updatedAt"
    )
    VALUES (
      'cp_edition_source_' || md5(NEW."competitionId" || ':' || source_system_id || ':' || source_external_id),
      NEW."competitionId",
      source_system_id,
      source_external_id,
      true,
      0,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("competitionId", "sourceSystemId", "externalId") DO UPDATE SET
      "enabled" = true,
      "lastSyncedAt" = CURRENT_TIMESTAMP,
      "updatedAt" = CURRENT_TIMESTAMP;

    INSERT INTO "SourceEntityMapping" (
      "id",
      "sourceSystemId",
      "competitionId",
      "entityType",
      "externalId",
      "internalEntityId",
      "verifiedAt",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      'cp_mapping_' || md5(
        source_system_id || ':' || NEW."competitionId" || ':MATCH:' || NEW."championDataMatchId"::text
      ),
      source_system_id,
      NEW."competitionId",
      'MATCH'::"SourceEntityType",
      NEW."championDataMatchId"::text,
      NEW."id",
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("sourceSystemId", "competitionId", "entityType", "externalId")
      WHERE "competitionId" IS NOT NULL DO UPDATE SET
      "internalEntityId" = EXCLUDED."internalEntityId",
      "verifiedAt" = EXCLUDED."verifiedAt",
      "updatedAt" = CURRENT_TIMESTAMP;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER "Match_sync_legacy_foundation"
AFTER INSERT OR UPDATE OF
  "competitionId",
  "homeTeamId",
  "awayTeamId",
  "championDataMatchId",
  "sourceCompetitionId"
ON "Match"
FOR EACH ROW
EXECUTE FUNCTION cp_sync_legacy_match_foundation();

-- Cross-table topology is validated at transaction end so importers can build
-- a related graph in any statement order while still being unable to commit a
-- stage/group/entry/match combination that crosses edition boundaries.
CREATE FUNCTION cp_validate_competition_topology()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  record_id TEXT;
  old_parent_match_id TEXT;
  new_parent_match_id TEXT;
  affected_match_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    record_id := OLD."id";
  ELSE
    record_id := NEW."id";
  END IF;

  IF TG_TABLE_NAME = 'MatchSlot' THEN
    IF TG_OP <> 'INSERT' THEN
      old_parent_match_id := OLD."matchId";
    END IF;
    IF TG_OP <> 'DELETE' THEN
      new_parent_match_id := NEW."matchId";
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'Stage' THEN
    IF EXISTS (
      SELECT 1
      FROM "Stage" s
      JOIN "Match" m ON m."stageId" = s."id"
      WHERE s."id" = record_id AND m."competitionId" <> s."competitionId"
    ) OR EXISTS (
      SELECT 1
      FROM "Stage" s
      JOIN "StageGroup" sg ON sg."stageId" = s."id"
      JOIN "EditionEntry" ee ON ee."primaryGroupId" = sg."id"
      WHERE s."id" = record_id AND ee."competitionId" <> s."competitionId"
    ) OR EXISTS (
      SELECT 1
      FROM "Stage" s
      JOIN "StageStanding" st ON st."stageId" = s."id"
      JOIN "EditionEntry" ee ON ee."id" = st."editionEntryId"
      WHERE s."id" = record_id AND ee."competitionId" <> s."competitionId"
    ) OR EXISTS (
      SELECT 1
      FROM "Stage" s
      JOIN "StageGroup" sg ON sg."stageId" = s."id"
      JOIN "MatchSlot" ms ON ms."sourceGroupId" = sg."id"
      JOIN "Match" m ON m."id" = ms."matchId"
      WHERE s."id" = record_id AND m."competitionId" <> s."competitionId"
    ) THEN
      RAISE EXCEPTION 'CP-01 topology violation: stage dependencies cross competitions';
    END IF;

  ELSIF TG_TABLE_NAME = 'StageGroup' THEN
    IF EXISTS (
      SELECT 1
      FROM "StageGroup" sg
      JOIN "Stage" s ON s."id" = sg."stageId"
      JOIN "EditionEntry" ee ON ee."primaryGroupId" = sg."id"
      WHERE sg."id" = record_id AND ee."competitionId" <> s."competitionId"
    ) OR EXISTS (
      SELECT 1
      FROM "StageGroup" sg
      JOIN "Match" m ON m."stageGroupId" = sg."id"
      WHERE sg."id" = record_id AND m."stageId" IS DISTINCT FROM sg."stageId"
    ) OR EXISTS (
      SELECT 1
      FROM "StageGroup" sg
      JOIN "Stage" s ON s."id" = sg."stageId"
      JOIN "MatchSlot" ms ON ms."sourceGroupId" = sg."id"
      JOIN "Match" m ON m."id" = ms."matchId"
      WHERE sg."id" = record_id AND m."competitionId" <> s."competitionId"
    ) OR EXISTS (
      SELECT 1
      FROM "StageGroup" sg
      JOIN "StageStanding" st ON st."stageGroupId" = sg."id"
      WHERE sg."id" = record_id AND st."stageId" <> sg."stageId"
    ) THEN
      RAISE EXCEPTION 'CP-01 topology violation: stage group dependencies cross stages or competitions';
    END IF;

  ELSIF TG_TABLE_NAME = 'EditionEntry' THEN
    IF EXISTS (
      SELECT 1
      FROM "EditionEntry" ee
      JOIN "StageGroup" sg ON sg."id" = ee."primaryGroupId"
      JOIN "Stage" s ON s."id" = sg."stageId"
      WHERE ee."id" = record_id AND ee."competitionId" <> s."competitionId"
    ) OR EXISTS (
      SELECT 1
      FROM "EditionEntry" ee
      JOIN "MatchSlot" ms ON ms."resolvedEntryId" = ee."id"
      JOIN "Match" m ON m."id" = ms."matchId"
      WHERE ee."id" = record_id AND ee."competitionId" <> m."competitionId"
    ) OR EXISTS (
      SELECT 1
      FROM "EditionEntry" ee
      JOIN "StageStanding" st ON st."editionEntryId" = ee."id"
      JOIN "Stage" s ON s."id" = st."stageId"
      WHERE ee."id" = record_id AND ee."competitionId" <> s."competitionId"
    ) THEN
      RAISE EXCEPTION 'CP-01 topology violation: edition entry dependencies cross competitions';
    END IF;

  ELSIF TG_TABLE_NAME = 'Match' THEN
    IF (SELECT count(*) FROM "MatchSlot" ms WHERE ms."matchId" = record_id) <> 2
    OR EXISTS (
      SELECT 1
      FROM "Match" m
      LEFT JOIN "Stage" s ON s."id" = m."stageId"
      WHERE m."id" = record_id
        AND (m."stageId" IS NULL OR s."competitionId" IS DISTINCT FROM m."competitionId")
    ) OR EXISTS (
      SELECT 1
      FROM "Match" m
      JOIN "StageGroup" sg ON sg."id" = m."stageGroupId"
      WHERE m."id" = record_id AND m."stageId" IS DISTINCT FROM sg."stageId"
    ) OR EXISTS (
      SELECT 1
      FROM "Match" m
      JOIN "MatchSlot" ms ON ms."matchId" = m."id"
      JOIN "EditionEntry" ee ON ee."id" = ms."resolvedEntryId"
      WHERE m."id" = record_id AND ee."competitionId" <> m."competitionId"
    ) OR EXISTS (
      SELECT 1
      FROM "Match" m
      JOIN "MatchSlot" ms ON ms."matchId" = m."id"
      JOIN "StageGroup" sg ON sg."id" = ms."sourceGroupId"
      JOIN "Stage" s ON s."id" = sg."stageId"
      WHERE m."id" = record_id AND s."competitionId" <> m."competitionId"
    ) OR EXISTS (
      SELECT 1
      FROM "Match" m
      JOIN "MatchSlot" ms ON ms."matchId" = m."id"
      JOIN "Match" source_match ON source_match."id" = ms."sourceMatchId"
      WHERE m."id" = record_id AND source_match."competitionId" <> m."competitionId"
    ) OR EXISTS (
      SELECT 1
      FROM "Match" m
      JOIN "DataCoverage" dc ON dc."matchId" = m."id"
      WHERE m."id" = record_id AND dc."competitionId" <> m."competitionId"
    ) THEN
      RAISE EXCEPTION 'CP-01 topology violation: match dependencies cross stages, entries, or competitions';
    END IF;

  ELSIF TG_TABLE_NAME = 'MatchSlot' THEN
    IF EXISTS (
      SELECT 1
      FROM "MatchSlot" ms
      JOIN "Match" m ON m."id" = ms."matchId"
      LEFT JOIN "EditionEntry" ee ON ee."id" = ms."resolvedEntryId"
      LEFT JOIN "StageGroup" sg ON sg."id" = ms."sourceGroupId"
      LEFT JOIN "Stage" s ON s."id" = sg."stageId"
      LEFT JOIN "Match" source_match ON source_match."id" = ms."sourceMatchId"
      WHERE ms."id" = record_id
        AND (
          (ms."resolvedEntryId" IS NOT NULL AND ee."competitionId" IS DISTINCT FROM m."competitionId")
          OR (ms."sourceGroupId" IS NOT NULL AND s."competitionId" IS DISTINCT FROM m."competitionId")
          OR (ms."sourceMatchId" IS NOT NULL AND source_match."competitionId" IS DISTINCT FROM m."competitionId")
        )
    ) THEN
      RAISE EXCEPTION 'CP-01 topology violation: match slot crosses competition boundaries';
    END IF;

    FOR affected_match_id IN
      SELECT DISTINCT candidate.parent_match_id
      FROM unnest(ARRAY[old_parent_match_id, new_parent_match_id]) AS candidate(parent_match_id)
      WHERE candidate.parent_match_id IS NOT NULL
    LOOP
      -- A Match delete cascades its slots. Once the parent is gone there is no
      -- cardinality invariant left to enforce for the queued DELETE events.
      IF EXISTS (SELECT 1 FROM "Match" m WHERE m."id" = affected_match_id)
        AND (
          SELECT count(*)
          FROM "MatchSlot" ms
          WHERE ms."matchId" = affected_match_id
        ) <> 2
      THEN
        RAISE EXCEPTION 'CP-01 topology violation: match must have exactly two slots';
      END IF;
    END LOOP;

  ELSIF TG_TABLE_NAME = 'StageStanding' THEN
    IF EXISTS (
      SELECT 1
      FROM "StageStanding" st
      JOIN "Stage" s ON s."id" = st."stageId"
      JOIN "EditionEntry" ee ON ee."id" = st."editionEntryId"
      LEFT JOIN "StageGroup" sg ON sg."id" = st."stageGroupId"
      WHERE st."id" = record_id
        AND (
          ee."competitionId" <> s."competitionId"
          OR (st."stageGroupId" IS NOT NULL AND sg."stageId" IS DISTINCT FROM st."stageId")
        )
    ) THEN
      RAISE EXCEPTION 'CP-01 topology violation: stage standing crosses a stage or competition boundary';
    END IF;

  ELSIF TG_TABLE_NAME = 'DataCoverage' THEN
    IF EXISTS (
      SELECT 1
      FROM "DataCoverage" dc
      JOIN "Match" m ON m."id" = dc."matchId"
      WHERE dc."id" = record_id AND dc."competitionId" <> m."competitionId"
    ) THEN
      RAISE EXCEPTION 'CP-01 topology violation: match coverage belongs to another competition';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "Stage_competition_topology"
AFTER INSERT OR UPDATE ON "Stage"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cp_validate_competition_topology();
CREATE CONSTRAINT TRIGGER "StageGroup_competition_topology"
AFTER INSERT OR UPDATE ON "StageGroup"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cp_validate_competition_topology();
CREATE CONSTRAINT TRIGGER "EditionEntry_competition_topology"
AFTER INSERT OR UPDATE ON "EditionEntry"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cp_validate_competition_topology();
CREATE CONSTRAINT TRIGGER "Match_competition_topology"
AFTER INSERT OR UPDATE ON "Match"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cp_validate_competition_topology();
CREATE CONSTRAINT TRIGGER "MatchSlot_competition_topology"
AFTER INSERT OR UPDATE OR DELETE ON "MatchSlot"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cp_validate_competition_topology();
CREATE CONSTRAINT TRIGGER "StageStanding_competition_topology"
AFTER INSERT OR UPDATE ON "StageStanding"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cp_validate_competition_topology();
CREATE CONSTRAINT TRIGGER "DataCoverage_competition_topology"
AFTER INSERT OR UPDATE ON "DataCoverage"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cp_validate_competition_topology();

-- Supabase security: CentrePass uses server-side Prisma only. Every new public
-- table is explicitly protected even if Data API defaults change later.
ALTER TABLE "CompetitionSeries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ruleset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Stage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StageGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StageStanding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EditionEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RosterMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MatchSlot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SourceSystem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EditionSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SourceEntityMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportIssue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportMutation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SourceSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataCoverage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlayerAlias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamAlias" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_data_api_access" ON "CompetitionSeries"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "Ruleset"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "Stage"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "StageGroup"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "StageStanding"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "EditionEntry"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "RosterMembership"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "MatchSlot"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "SourceSystem"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "EditionSource"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "SourceEntityMapping"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "ImportRun"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "ImportIssue"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "ImportMutation"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "SourceSnapshot"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "DataCoverage"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "PlayerAlias"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "TeamAlias"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

REVOKE ALL PRIVILEGES ON TABLE "CompetitionSeries" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "Ruleset" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "Stage" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "StageGroup" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "StageStanding" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "EditionEntry" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "RosterMembership" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "MatchSlot" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "SourceSystem" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "EditionSource" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "SourceEntityMapping" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "ImportRun" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "ImportIssue" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "ImportMutation" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "SourceSnapshot" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "DataCoverage" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "PlayerAlias" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "TeamAlias" FROM anon, authenticated;

COMMIT;
