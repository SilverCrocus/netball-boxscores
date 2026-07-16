import { readFile } from 'node:fs/promises';

const [bundleFile, previewFile] = process.argv.slice(2);
if (!bundleFile || !previewFile) {
  throw new Error('Usage: node scripts/build-glasgow-2026-sql-transport.mjs <bundle.json> <preview.json>');
}

const bundleText = await readFile(bundleFile, 'utf8');
const previewText = await readFile(previewFile, 'utf8');
const bundle = JSON.parse(bundleText);
const preview = JSON.parse(previewText);
if (bundle.context?.editionExternalId !== 'glasgow-2026') {
  throw new Error('SQL transport only accepts the Glasgow 2026 edition bundle');
}
if (!preview.valid || preview.issues.length || preview.unresolved.length) {
  throw new Error('Refusing to build SQL for a bundle without a clean validated preview');
}

const bundleBase64 = Buffer.from(bundleText).toString('base64');
const inserted = preview.writes.filter((write) => write.operation === 'INSERT').length;
const updated = preview.writes.filter((write) => write.operation === 'UPDATE').length;
const skipped = preview.writes.filter((write) => write.operation === 'SKIP').length;
const previewAudit = {
  checksum: preview.checksum,
  valid: preview.valid,
  issues: preview.issues,
  unresolved: preview.unresolved,
  writeCount: preview.writes.length,
  operations: { inserted, updated, skipped },
};
const previewBase64 = Buffer.from(JSON.stringify(previewAudit)).toString('base64');

process.stdout.write(`
DO $glasgow_import$
DECLARE
  bundle jsonb := convert_from(decode('${bundleBase64}', 'base64'), 'utf8')::jsonb;
  preview jsonb := convert_from(decode('${previewBase64}', 'base64'), 'utf8')::jsonb;
  checksum_value text := '${preview.checksum}';
  retrieved_at timestamptz := (bundle #>> '{context,retrievedAt}')::timestamptz;
  now_value timestamptz := clock_timestamp();
  competition_id text;
  source_system_id text;
  edition_source_id text;
  import_run_id text := gen_random_uuid()::text;
  item jsonb;
  side_item jsonb;
  entity_id text;
  mapping_id text;
  entry_id text;
  stage_id text;
  group_id text;
  resolved_entry_id text;
  match_id text;
  mutation_sequence integer := 0;
  team_ids jsonb := '{}'::jsonb;
  entry_ids jsonb := '{}'::jsonb;
  player_ids jsonb := '{}'::jsonb;
  match_ids jsonb := '{}'::jsonb;
BEGIN
  SELECT id INTO STRICT competition_id
  FROM "Competition"
  WHERE slug = 'glasgow-2026' AND "publicationStatus" = 'DRAFT';

  SELECT id INTO STRICT source_system_id
  FROM "SourceSystem"
  WHERE key = (bundle #>> '{context,sourceKey}');

  SELECT id INTO STRICT edition_source_id
  FROM "EditionSource"
  WHERE "competitionId" = competition_id
    AND "sourceSystemId" = source_system_id
    AND "externalId" = (bundle #>> '{context,editionExternalId}');

  IF EXISTS (
    SELECT 1 FROM "SourceEntityMapping"
    WHERE "competitionId" = competition_id AND "sourceSystemId" = source_system_id
  ) THEN
    RAISE EXCEPTION 'Glasgow mappings already exist; this first-import SQL transport is intentionally non-replayable';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "ImportRun"
    WHERE "competitionId" = competition_id AND checksum = checksum_value AND status = 'SUCCEEDED'
  ) THEN
    RAISE EXCEPTION 'Validated Glasgow bundle checksum has already succeeded';
  END IF;

  INSERT INTO "ImportRun" (
    id, "sourceSystemId", "competitionId", "editionSourceId", trigger, status,
    "dryRun", "retrievedAt", checksum, "issueCount", metadata
  ) VALUES (
    import_run_id, source_system_id, competition_id, edition_source_id,
    'MANUAL'::"ImportTrigger", 'RUNNING'::"ImportStatus", false,
    retrieved_at, checksum_value, 0,
    jsonb_build_object('preview', preview, 'transport', 'supabase-mcp-atomic-sql')
  );

  FOR item IN SELECT value FROM jsonb_array_elements(bundle->'teams') LOOP
    IF EXISTS (SELECT 1 FROM "Team" WHERE slug = item->>'slug') THEN
      RAISE EXCEPTION 'Team slug already exists: %', item->>'slug';
    END IF;
    entity_id := gen_random_uuid()::text;
    INSERT INTO "Team" (id, name, slug, abbreviation, "competitionId")
    VALUES (entity_id, item->>'name', item->>'slug', item->>'abbreviation', competition_id);
    team_ids := team_ids || jsonb_build_object(item->>'externalId', entity_id);
    mutation_sequence := mutation_sequence + 1;
    INSERT INTO "ImportMutation" (id, "importRunId", sequence, operation, target, "entityId", "afterData")
    VALUES (gen_random_uuid()::text, import_run_id, mutation_sequence, 'INSERT', 'TEAM', entity_id, item);

    mapping_id := gen_random_uuid()::text;
    INSERT INTO "SourceEntityMapping" (
      id, "sourceSystemId", "competitionId", "entityType", "externalId",
      "internalEntityId", metadata, "verifiedAt", "updatedAt"
    ) VALUES (
      mapping_id, source_system_id, competition_id, 'TEAM', item->>'externalId', entity_id,
      jsonb_build_object('sourceKey', bundle #>> '{context,sourceKey}', 'editionExternalId', bundle #>> '{context,editionExternalId}', 'lastChecksum', checksum_value),
      retrieved_at, now_value
    );
    mutation_sequence := mutation_sequence + 1;
    INSERT INTO "ImportMutation" (id, "importRunId", sequence, operation, target, "entityId", "afterData")
    VALUES (gen_random_uuid()::text, import_run_id, mutation_sequence, 'INSERT', 'SOURCE_ENTITY_MAPPING', mapping_id, item);

    SELECT sg.id INTO STRICT group_id
    FROM "StageGroup" sg
    JOIN "Stage" s ON s.id = sg."stageId"
    WHERE s."competitionId" = competition_id AND sg.slug = item->>'groupSlug';
    entry_id := gen_random_uuid()::text;
    INSERT INTO "EditionEntry" (
      id, "competitionId", "teamId", "primaryGroupId", status, seed, "displayName", "enteredAt"
    ) VALUES (
      entry_id, competition_id, entity_id, group_id,
      (item->>'status')::"EditionEntryStatus", (item->>'seed')::integer,
      item->>'name', retrieved_at
    );
    entry_ids := entry_ids || jsonb_build_object(item->>'externalId', entry_id);
    mutation_sequence := mutation_sequence + 1;
    INSERT INTO "ImportMutation" (id, "importRunId", sequence, operation, target, "entityId", "afterData")
    VALUES (gen_random_uuid()::text, import_run_id, mutation_sequence, 'INSERT', 'EDITION_ENTRY', entry_id, item);
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(bundle->'players') LOOP
    entity_id := gen_random_uuid()::text;
    INSERT INTO "Player" (
      id, name, position, "teamId", "photoUrl", "photoSourceUrl", "photoCredit", "photoLicense", "photoVerifiedAt"
    ) VALUES (
      entity_id, item->>'name', (item->>'position')::"Position", team_ids->>(item->>'teamExternalId'),
      item->>'photoUrl', item->>'photoSourceUrl', item->>'photoCredit', item->>'photoLicense',
      CASE WHEN item ? 'photoVerifiedAt' THEN (item->>'photoVerifiedAt')::timestamptz ELSE NULL END
    );
    player_ids := player_ids || jsonb_build_object(item->>'externalId', entity_id);
    mutation_sequence := mutation_sequence + 1;
    INSERT INTO "ImportMutation" (id, "importRunId", sequence, operation, target, "entityId", "afterData")
    VALUES (gen_random_uuid()::text, import_run_id, mutation_sequence, 'INSERT', 'PLAYER', entity_id, item);

    mapping_id := gen_random_uuid()::text;
    INSERT INTO "SourceEntityMapping" (
      id, "sourceSystemId", "competitionId", "entityType", "externalId",
      "internalEntityId", metadata, "verifiedAt", "updatedAt"
    ) VALUES (
      mapping_id, source_system_id, competition_id, 'PLAYER', item->>'externalId', entity_id,
      jsonb_build_object('sourceKey', bundle #>> '{context,sourceKey}', 'editionExternalId', bundle #>> '{context,editionExternalId}', 'lastChecksum', checksum_value),
      retrieved_at, now_value
    );
    mutation_sequence := mutation_sequence + 1;
    INSERT INTO "ImportMutation" (id, "importRunId", sequence, operation, target, "entityId", "afterData")
    VALUES (gen_random_uuid()::text, import_run_id, mutation_sequence, 'INSERT', 'SOURCE_ENTITY_MAPPING', mapping_id, item);
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(bundle->'rosters') LOOP
    entity_id := gen_random_uuid()::text;
    INSERT INTO "RosterMembership" (
      id, "editionEntryId", "playerId", status, "validFrom", bib, "isCaptain"
    ) VALUES (
      entity_id, entry_ids->>(item->>'teamExternalId'), player_ids->>(item->>'playerExternalId'),
      (item->>'status')::"RosterMembershipStatus", retrieved_at, item->>'bib',
      coalesce((item->>'isCaptain')::boolean, false)
    );
    mutation_sequence := mutation_sequence + 1;
    INSERT INTO "ImportMutation" (id, "importRunId", sequence, operation, target, "entityId", "afterData")
    VALUES (gen_random_uuid()::text, import_run_id, mutation_sequence, 'INSERT', 'ROSTER_MEMBERSHIP', entity_id, item);
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(bundle->'matches') LOOP
    SELECT id INTO STRICT stage_id FROM "Stage"
    WHERE "competitionId" = competition_id AND slug = item->>'stageSlug';
    group_id := NULL;
    IF item ? 'groupSlug' THEN
      SELECT sg.id INTO STRICT group_id FROM "StageGroup" sg
      WHERE sg."stageId" = stage_id AND sg.slug = item->>'groupSlug';
    END IF;
    entity_id := gen_random_uuid()::text;
    INSERT INTO "Match" (
      id, "competitionId", "homeTeamId", "awayTeamId", round, "roundLabel", venue,
      "neutralVenue", "scheduledAt", status, "updatedAt", "sourceRetrievedAt", "stageId", "stageGroupId"
    ) VALUES (
      entity_id, competition_id,
      CASE WHEN item #>> '{sideA,teamExternalId}' IS NULL THEN NULL ELSE team_ids->>(item #>> '{sideA,teamExternalId}') END,
      CASE WHEN item #>> '{sideB,teamExternalId}' IS NULL THEN NULL ELSE team_ids->>(item #>> '{sideB,teamExternalId}') END,
      CASE WHEN item ? 'round' THEN (item->>'round')::integer ELSE NULL END,
      item->>'roundLabel', item->>'venue', (item->>'neutralVenue')::boolean,
      (item->>'scheduledAt')::timestamptz, (item->>'status')::"MatchStatus", now_value,
      retrieved_at, stage_id, group_id
    );
    match_id := entity_id;
    match_ids := match_ids || jsonb_build_object(item->>'externalId', entity_id);
    mutation_sequence := mutation_sequence + 1;
    INSERT INTO "ImportMutation" (id, "importRunId", sequence, operation, target, "entityId", "afterData")
    VALUES (gen_random_uuid()::text, import_run_id, mutation_sequence, 'INSERT', 'MATCH', entity_id, item);

    mapping_id := gen_random_uuid()::text;
    INSERT INTO "SourceEntityMapping" (
      id, "sourceSystemId", "competitionId", "entityType", "externalId",
      "internalEntityId", metadata, "verifiedAt", "updatedAt"
    ) VALUES (
      mapping_id, source_system_id, competition_id, 'MATCH', item->>'externalId', entity_id,
      jsonb_build_object('sourceKey', bundle #>> '{context,sourceKey}', 'editionExternalId', bundle #>> '{context,editionExternalId}', 'lastChecksum', checksum_value),
      retrieved_at, now_value
    );
    mutation_sequence := mutation_sequence + 1;
    INSERT INTO "ImportMutation" (id, "importRunId", sequence, operation, target, "entityId", "afterData")
    VALUES (gen_random_uuid()::text, import_run_id, mutation_sequence, 'INSERT', 'SOURCE_ENTITY_MAPPING', mapping_id, item);

  END LOOP;

  INSERT INTO "MatchSlot" (
    id, "matchId", side, "sourceType", "resolvedEntryId", "sourceMatchId", "sourceLabel", "resolvedAt"
  )
  SELECT
    gen_random_uuid()::text,
    match_mapping."internalEntityId",
    sides.side,
    (sides.payload->>'sourceType')::"MatchSlotSourceType",
    entry.id,
    source_match_mapping."internalEntityId",
    sides.payload->>'sourceLabel',
    CASE WHEN entry.id IS NULL THEN NULL ELSE retrieved_at END
  FROM jsonb_array_elements(bundle->'matches') AS match_payload(value)
  JOIN "SourceEntityMapping" match_mapping
    ON match_mapping."sourceSystemId" = source_system_id
   AND match_mapping."competitionId" = competition_id
   AND match_mapping."entityType" = 'MATCH'
   AND match_mapping."externalId" = match_payload.value->>'externalId'
  CROSS JOIN LATERAL (VALUES
    ('A'::"MatchSide", match_payload.value->'sideA'),
    ('B'::"MatchSide", match_payload.value->'sideB')
  ) AS sides(side, payload)
  LEFT JOIN "SourceEntityMapping" team_mapping
    ON team_mapping."sourceSystemId" = source_system_id
   AND team_mapping."competitionId" = competition_id
   AND team_mapping."entityType" = 'TEAM'
   AND team_mapping."externalId" = sides.payload->>'teamExternalId'
  LEFT JOIN "EditionEntry" entry
    ON entry."competitionId" = competition_id
   AND entry."teamId" = team_mapping."internalEntityId"
  LEFT JOIN "SourceEntityMapping" source_match_mapping
    ON source_match_mapping."sourceSystemId" = source_system_id
   AND source_match_mapping."competitionId" = competition_id
   AND source_match_mapping."entityType" = 'MATCH'
   AND source_match_mapping."externalId" = sides.payload->>'sourceMatchExternalId'
  ON CONFLICT ("matchId", side) DO UPDATE SET
    "sourceType" = EXCLUDED."sourceType",
    "resolvedEntryId" = EXCLUDED."resolvedEntryId",
    "sourceGroupId" = NULL,
    "sourceRank" = NULL,
    "sourceMatchId" = EXCLUDED."sourceMatchId",
    "sourceLabel" = EXCLUDED."sourceLabel",
    "resolvedAt" = EXCLUDED."resolvedAt";

  INSERT INTO "ImportMutation" (
    id, "importRunId", sequence, operation, target, "entityId", "afterData"
  )
  SELECT
    gen_random_uuid()::text, import_run_id,
    mutation_sequence + row_number() OVER (ORDER BY match."scheduledAt", slot.side),
    'INSERT'::"ImportMutationOperation",
    'MATCH_SLOT'::"ImportMutationTarget", slot.id, to_jsonb(slot)
  FROM "MatchSlot" slot
  JOIN "Match" match ON match.id = slot."matchId"
  WHERE match."competitionId" = competition_id;
  mutation_sequence := mutation_sequence + 76;

  FOR item IN SELECT value FROM jsonb_array_elements(bundle->'coverage') LOOP
    entity_id := gen_random_uuid()::text;
    INSERT INTO "DataCoverage" (
      id, "competitionId", "sourceSystemId", capability, state, "observedAt", notes
    ) VALUES (
      entity_id, competition_id, source_system_id,
      (item->>'capability')::"DataCapability", (item->>'state')::"CoverageState",
      retrieved_at, item->>'notes'
    );
    mutation_sequence := mutation_sequence + 1;
    INSERT INTO "ImportMutation" (id, "importRunId", sequence, operation, target, "entityId", "afterData")
    VALUES (gen_random_uuid()::text, import_run_id, mutation_sequence, 'INSERT', 'DATA_COVERAGE', entity_id, item);
  END LOOP;

  INSERT INTO "SourceSnapshot" (
    id, "dedupeKey", "sourceSystemId", "importRunId", "competitionId", "entityType",
    "externalId", "sourceUrl", "retrievedAt", checksum, "rawPayload", metadata
  ) VALUES (
    gen_random_uuid()::text, source_system_id || ':' || competition_id || ':' || checksum_value,
    source_system_id, import_run_id, competition_id, 'COMPETITION_EDITION',
    bundle #>> '{context,editionExternalId}', bundle #>> '{context,sourceUrl}', retrieved_at,
    checksum_value, bundle,
    jsonb_build_object('teamCount', jsonb_array_length(bundle->'teams'), 'playerCount', jsonb_array_length(bundle->'players'), 'matchCount', jsonb_array_length(bundle->'matches'))
  );

  UPDATE "ImportRun" SET
    status = 'SUCCEEDED', "completedAt" = clock_timestamp(),
    "insertedCount" = ${inserted}, "updatedCount" = ${updated}, "skippedCount" = ${skipped}
  WHERE id = import_run_id;

  UPDATE "EditionSource" SET "lastSyncedAt" = retrieved_at, "updatedAt" = clock_timestamp()
  WHERE id = edition_source_id;
END
$glasgow_import$;
`);
