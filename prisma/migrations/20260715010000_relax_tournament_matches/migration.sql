-- CP-02B: permit provider-neutral editions and unresolved tournament fixtures.
-- This migration changes no rows. Existing SSN values remain populated so the
-- immediately previous release can continue reading during a rolling deploy.
BEGIN;

ALTER TYPE "MatchStatus" ADD VALUE IF NOT EXISTS 'DELAYED';
ALTER TYPE "MatchStatus" ADD VALUE IF NOT EXISTS 'POSTPONED';
ALTER TYPE "MatchStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "MatchStatus" ADD VALUE IF NOT EXISTS 'ABANDONED';

ALTER TABLE "Competition"
  ALTER COLUMN "championDataId" DROP NOT NULL;

ALTER TABLE "Match"
  ALTER COLUMN "homeTeamId" DROP NOT NULL,
  ALTER COLUMN "awayTeamId" DROP NOT NULL,
  ALTER COLUMN "round" DROP NOT NULL;

DO $$
DECLARE
  missing_status_count INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Competition'
      AND column_name = 'championDataId'
      AND is_nullable <> 'YES'
  ) OR EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Match'
      AND column_name IN ('homeTeamId', 'awayTeamId', 'round')
      AND is_nullable <> 'YES'
  ) THEN
    RAISE EXCEPTION 'CP-02B verification failed: tournament columns are still required';
  END IF;

  SELECT count(*)
  INTO missing_status_count
  FROM unnest(ARRAY['DELAYED', 'POSTPONED', 'CANCELLED', 'ABANDONED']) expected(value)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_type enum_type
    JOIN pg_enum enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE enum_type.typname = 'MatchStatus'
      AND enum_value.enumlabel = expected.value
  );

  IF missing_status_count <> 0 THEN
    RAISE EXCEPTION 'CP-02B verification failed: fixture lifecycle status missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Match_homeTeamId_fkey'
      AND conrelid = '"Match"'::regclass
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Match_awayTeamId_fkey'
      AND conrelid = '"Match"'::regclass
  ) THEN
    RAISE EXCEPTION 'CP-02B verification failed: optional team foreign keys missing';
  END IF;

  IF to_regclass('public."Competition_championDataId_key"') IS NULL
    OR to_regclass('public."Match_homeTeamId_scheduledAt_idx"') IS NULL
    OR to_regclass('public."Match_awayTeamId_scheduledAt_idx"') IS NULL
  THEN
    RAISE EXCEPTION 'CP-02B verification failed: compatibility indexes missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid IN ('"Competition"'::regclass, '"Match"'::regclass)
      AND relrowsecurity = false
  ) THEN
    RAISE EXCEPTION 'CP-02B verification failed: RLS disabled on a changed table';
  END IF;

  -- CP-01 made these columns mandatory, so any null here would indicate that
  -- out-of-sequence tournament data was inserted before the expanded reader.
  IF EXISTS (
    SELECT 1 FROM "Competition" WHERE "championDataId" IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM "Match"
    WHERE "homeTeamId" IS NULL OR "awayTeamId" IS NULL OR "round" IS NULL
  ) THEN
    RAISE EXCEPTION 'CP-02B verification failed: unresolved data predates compatible application deploy';
  END IF;
END
$$;

COMMIT;
