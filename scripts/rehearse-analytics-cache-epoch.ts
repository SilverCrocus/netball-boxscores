import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

const SERIES_ID = 'rehearsal-series-glasgow';
const COMPETITION_ID = 'rehearsal-glasgow-2026';
const MOVE_TARGET_SERIES_ID = 'rehearsal-series-move-target';
const MOVE_TARGET_COMPETITION_ID = 'rehearsal-move-target';
const MOVE_TARGET_STAGE_ID = 'rehearsal-stage-move-target';
const SOURCE_SYSTEM_ID = 'rehearsal-source-glasgow';
const ELIGIBLE_MATCH_ID = 'rehearsal-match-01';
const SECOND_ELIGIBLE_MATCH_ID = 'rehearsal-match-02';
const FINAL_MATCH_ID = 'rehearsal-match-38';
const EXTRA_MATCH_ID = 'rehearsal-match-39';
const PLAYER_ID = 'rehearsal-player-01';
const PLAYER_STATS_ID = 'rehearsal-player-stats-01';
const TEAM_STATS_ID = 'rehearsal-team-stats-01';
const COVERAGE_ID = 'rehearsal-coverage-player';
const IRRELEVANT_COVERAGE_ID = 'rehearsal-coverage-final-score';
const FIXTURE_UPDATED_AT = new Date('2026-07-22T00:00:00.000Z');

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Analytics cache epoch rehearsal failed: ${message}`);
}

function verifyLocalTarget() {
  for (const name of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    const raw = process.env[name];
    invariant(raw, `${name} is required`);
    const url = new URL(raw);
    invariant(['127.0.0.1', 'localhost', '::1'].includes(url.hostname),
      `${name} must target the ephemeral local PostgreSQL service`);
  }
  invariant(process.env.FRESH_MIGRATION_REHEARSAL === 'true',
    'FRESH_MIGRATION_REHEARSAL must be true');
}

async function readEpoch(): Promise<bigint> {
  const rows = await prisma.$queryRaw<Array<{
    revision: bigint;
    contract_version: string;
    invalidated_at: Date;
  }>>(Prisma.sql`
    SELECT revision, contract_version, invalidated_at
    FROM analytics.cache_revision_read
  `);
  const row = rows[0];
  invariant(row, 'global epoch view returned no singleton row');
  invariant(row.contract_version === 'analytics-cache-epoch.v1',
    `unexpected epoch contract ${row.contract_version}`);
  invariant(row.revision > BigInt(0), 'global epoch revision is not positive');
  invariant(row.invalidated_at instanceof Date, 'global epoch invalidated_at is not a timestamp');
  return row.revision;
}

async function directoryVisible(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ competition_id: string }>>(Prisma.sql`
    SELECT competition_id
    FROM analytics.competition_directory
    WHERE competition_id = ${COMPETITION_ID}
  `);
  return rows.length === 1;
}

async function readGlasgowGateCounts(): Promise<{
  activeEntries: bigint;
  matches: bigint;
  slots: bigint;
}> {
  const [row] = await prisma.$queryRaw<Array<{
    active_entries: bigint;
    matches: bigint;
    slots: bigint;
  }>>(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM public."EditionEntry"
        WHERE "competitionId" = ${COMPETITION_ID}
          AND "status" = 'ACTIVE'::public."EditionEntryStatus")::bigint AS active_entries,
      (SELECT COUNT(*) FROM public."Match"
        WHERE "competitionId" = ${COMPETITION_ID})::bigint AS matches,
      (SELECT COUNT(*)
        FROM public."MatchSlot" slot
        JOIN public."Match" match ON match."id" = slot."matchId"
        WHERE match."competitionId" = ${COMPETITION_ID})::bigint AS slots
  `);
  invariant(row, 'Glasgow gate count query returned no row');
  return {
    activeEntries: row.active_entries,
    matches: row.matches,
    slots: row.slots,
  };
}

async function expectEpochChanged(previous: bigint, label: string): Promise<bigint> {
  const next = await readEpoch();
  invariant(next > previous, `${label} did not advance the global epoch`);
  return next;
}

async function expectEpochUnchanged(previous: bigint, label: string): Promise<bigint> {
  const next = await readEpoch();
  invariant(next === previous, `${label} unexpectedly advanced the global epoch`);
  return next;
}

async function seedPublishedGlasgowFixture() {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public."CompetitionSeries" ("id", "slug", "name", "kind", "updatedAt")
    VALUES (${SERIES_ID}, 'commonwealth-games-netball', 'Commonwealth Games Netball', 'TOURNAMENT'::public."CompetitionKind", ${FIXTURE_UPDATED_AT})
  `);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public."Competition" (
      "id", "name", "season", "seriesId", "slug", "label", "publicationStatus", "publishedAt"
    ) VALUES (
      ${COMPETITION_ID}, 'Glasgow 2026', 2026, ${SERIES_ID}, 'glasgow-2026', 'Glasgow 2026',
      'PUBLISHED'::public."PublicationStatus", TIMESTAMPTZ '2026-07-01 00:00:00+00'
    )
  `);

  const teams = Array.from({ length: 12 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return Prisma.sql`(
      ${`rehearsal-team-${number}`}, ${`Rehearsal Team ${number}`}, ${`rehearsal-team-${number}`},
      ${`T${number}`}, ${COMPETITION_ID}
    )`;
  });
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public."Team" ("id", "name", "slug", "abbreviation", "competitionId")
    VALUES ${Prisma.join(teams)}
  `);

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public."Stage" ("id", "competitionId", "slug", "name", "type", "sequence", "isPublished")
    VALUES
      ('rehearsal-stage-pool', ${COMPETITION_ID}, 'pool-stage', 'Pool Stage', 'POOL'::public."StageType", 1, true),
      ('rehearsal-stage-classification', ${COMPETITION_ID}, 'classification', 'Classification', 'CLASSIFICATION'::public."StageType", 2, true),
      ('rehearsal-stage-semi-finals', ${COMPETITION_ID}, 'semi-finals', 'Semi-finals', 'SEMI_FINALS'::public."StageType", 3, true),
      ('rehearsal-stage-medal-matches', ${COMPETITION_ID}, 'medal-matches', 'Medal matches', 'MEDAL_MATCHES'::public."StageType", 4, true)
  `);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public."StageGroup" ("id", "stageId", "slug", "name", "sequence")
    VALUES
      ('rehearsal-group-a', 'rehearsal-stage-pool', 'pool-a', 'Pool A', 1),
      ('rehearsal-group-b', 'rehearsal-stage-pool', 'pool-b', 'Pool B', 2)
  `);

  const entries = Array.from({ length: 12 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return Prisma.sql`(
      ${`rehearsal-entry-${number}`}, ${COMPETITION_ID}, ${`rehearsal-team-${number}`},
      'ACTIVE'::public."EditionEntryStatus", ${`Rehearsal Entry ${number}`}
    )`;
  });
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public."EditionEntry" ("id", "competitionId", "teamId", "status", "displayName")
    VALUES ${Prisma.join(entries)}
  `);

  const matches = Array.from({ length: 37 }, (_, offset) => {
    const number = offset + 1;
    const id = `rehearsal-match-${String(number).padStart(2, '0')}`;
    const stage = number <= 30
      ? 'rehearsal-stage-pool'
      : number <= 34
        ? 'rehearsal-stage-classification'
        : number <= 36
          ? 'rehearsal-stage-semi-finals'
          : 'rehearsal-stage-medal-matches';
    const stageGroup = number <= 15 ? 'rehearsal-group-a' : number <= 30 ? 'rehearsal-group-b' : null;
    const completed = number === 1 || number === 2;
    const scheduledAt = new Date(Date.UTC(2026, 6, 1 + number));
    return Prisma.sql`(
      ${id}, ${COMPETITION_ID}, NULL, NULL, 'Glasgow rehearsal venue',
      ${scheduledAt}, ${completed ? 'COMPLETED' : 'SCHEDULED'}::public."MatchStatus",
      ${number}, ${number - 1}, ${completed ? 'OFFICIAL_FINAL' : 'UNKNOWN'}::public."ResultQualityStatus",
      ${stage}, ${stageGroup}, ${FIXTURE_UPDATED_AT}
    )`;
  });
  const slots = matches.flatMap((_, index) => {
    const matchId = `rehearsal-match-${String(index + 1).padStart(2, '0')}`;
    return [
      Prisma.sql`(${`rehearsal-slot-${String(index + 1).padStart(2, '0')}-a`}, ${matchId}, 'A'::public."MatchSide", 'UNRESOLVED'::public."MatchSlotSourceType")`,
      Prisma.sql`(${`rehearsal-slot-${String(index + 1).padStart(2, '0')}-b`}, ${matchId}, 'B'::public."MatchSide", 'UNRESOLVED'::public."MatchSlotSourceType")`,
    ];
  });
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO public."Match" (
        "id", "competitionId", "homeTeamId", "awayTeamId", "venue", "scheduledAt",
        "status", "homeScore", "awayScore", "resultQuality", "stageId", "stageGroupId", "updatedAt"
      ) VALUES ${Prisma.join(matches)}
    `);
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO public."MatchSlot" ("id", "matchId", "side", "sourceType")
      VALUES ${Prisma.join(slots)}
    `);
  });

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public."SourceSystem" ("id", "key", "name", "kind", "updatedAt")
    VALUES (
      ${SOURCE_SYSTEM_ID}, 'glasgow-2026-public-data', 'Glasgow rehearsal source',
      'PUBLIC_PAGE'::public."SourceSystemKind", ${FIXTURE_UPDATED_AT}
    )
  `);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public."ImportRun" (
      "id", "sourceSystemId", "competitionId", "trigger", "status", "dryRun", "issueCount"
    ) VALUES (
      'rehearsal-import-run', ${SOURCE_SYSTEM_ID}, ${COMPETITION_ID},
      'MANUAL'::public."ImportTrigger", 'SUCCEEDED'::public."ImportStatus", false, 0
    )
  `);
}

async function insertMatch38() {
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO public."Match" (
        "id", "competitionId", "homeTeamId", "awayTeamId", "venue", "scheduledAt",
        "status", "homeScore", "awayScore", "resultQuality", "stageId", "updatedAt"
      ) VALUES (
        ${FINAL_MATCH_ID}, ${COMPETITION_ID}, NULL, NULL,
        'Glasgow rehearsal venue', TIMESTAMPTZ '2026-08-15 00:00:00+00',
        'SCHEDULED'::public."MatchStatus", 0, 0, 'UNKNOWN'::public."ResultQualityStatus",
        'rehearsal-stage-medal-matches', ${FIXTURE_UPDATED_AT}
      )
    `);
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO public."MatchSlot" ("id", "matchId", "side", "sourceType")
      VALUES
        ('rehearsal-slot-38-a', ${FINAL_MATCH_ID}, 'A'::public."MatchSide", 'UNRESOLVED'::public."MatchSlotSourceType"),
        ('rehearsal-slot-38-b', ${FINAL_MATCH_ID}, 'B'::public."MatchSide", 'UNRESOLVED'::public."MatchSlotSourceType")
    `);
  });
}

async function runStructuralScenarios() {
  let revision = await readEpoch();
  const initialGate = await readGlasgowGateCounts();
  invariant(initialGate.activeEntries === BigInt(12)
    && initialGate.matches === BigInt(37)
    && initialGate.slots === BigInt(74),
  `initial Glasgow gate counts were ${initialGate.activeEntries}/${initialGate.matches}/${initialGate.slots}`);
  invariant(!(await directoryVisible()), '37-match Glasgow fixture unexpectedly published');

  await insertMatch38();
  revision = await expectEpochChanged(revision, '37-to-38 Match INSERT');
  const completeGate = await readGlasgowGateCounts();
  invariant(completeGate.activeEntries === BigInt(12)
    && completeGate.matches === BigInt(38)
    && completeGate.slots === BigInt(76),
  `complete Glasgow gate counts were ${completeGate.activeEntries}/${completeGate.matches}/${completeGate.slots}`);
  invariant(await directoryVisible(), '38-match Glasgow fixture did not publish');

  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO public."Match" (
        "id", "competitionId", "homeTeamId", "awayTeamId", "venue", "scheduledAt",
        "status", "homeScore", "awayScore", "resultQuality", "stageId", "updatedAt"
      ) VALUES (
        ${EXTRA_MATCH_ID}, ${COMPETITION_ID}, NULL, NULL,
        'Glasgow rehearsal venue', TIMESTAMPTZ '2026-08-16 00:00:00+00',
        'SCHEDULED'::public."MatchStatus", 0, 0, 'UNKNOWN'::public."ResultQualityStatus",
        'rehearsal-stage-classification', ${FIXTURE_UPDATED_AT}
      )
    `);
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO public."MatchSlot" ("id", "matchId", "side", "sourceType")
      VALUES
        ('rehearsal-slot-39-a', ${EXTRA_MATCH_ID}, 'A'::public."MatchSide", 'UNRESOLVED'::public."MatchSlotSourceType"),
        ('rehearsal-slot-39-b', ${EXTRA_MATCH_ID}, 'B'::public."MatchSide", 'UNRESOLVED'::public."MatchSlotSourceType")
    `);
  });
  revision = await expectEpochChanged(revision, '38-to-39 Match INSERT');
  invariant(!(await directoryVisible()), '39-match Glasgow fixture remained published');

  await prisma.$executeRaw(Prisma.sql`DELETE FROM public."Match" WHERE "id" = ${EXTRA_MATCH_ID}`);
  revision = await expectEpochChanged(revision, '39-to-38 Match DELETE');
  invariant(await directoryVisible(), 'deleting the 39th match did not restore publication');

  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."Match"
    SET "stageId" = 'rehearsal-stage-classification', "stageGroupId" = NULL
    WHERE "id" = ${FINAL_MATCH_ID}
  `);
  revision = await expectEpochChanged(revision, 'Glasgow stage-count transition into classification');
  invariant(!(await directoryVisible()), 'invalid Glasgow stage count remained published');

  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."Match"
    SET "stageId" = 'rehearsal-stage-medal-matches', "stageGroupId" = NULL
    WHERE "id" = ${FINAL_MATCH_ID}
  `);
  revision = await expectEpochChanged(revision, 'Glasgow stage-count transition back to medal matches');
  invariant(await directoryVisible(), 'restored Glasgow stage count remained unpublished');

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public."CompetitionSeries" ("id", "slug", "name", "kind", "updatedAt")
    VALUES (${MOVE_TARGET_SERIES_ID}, 'rehearsal-move-target-series', 'Rehearsal move target', 'TOURNAMENT'::public."CompetitionKind", ${FIXTURE_UPDATED_AT})
  `);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public."Competition" ("id", "name", "season", "seriesId", "slug", "publicationStatus")
    VALUES (
      ${MOVE_TARGET_COMPETITION_ID}, 'Rehearsal move target', 2026, ${MOVE_TARGET_SERIES_ID},
      'rehearsal-move-target', 'DRAFT'::public."PublicationStatus"
    )
  `);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public."Stage" ("id", "competitionId", "slug", "name", "type", "sequence", "isPublished")
    VALUES (
      ${MOVE_TARGET_STAGE_ID}, ${MOVE_TARGET_COMPETITION_ID}, 'move-target', 'Move target',
      'OTHER'::public."StageType", 1, true
    )
  `);
  revision = await readEpoch();
  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."Match"
    SET "competitionId" = ${MOVE_TARGET_COMPETITION_ID}, "stageId" = ${MOVE_TARGET_STAGE_ID}, "stageGroupId" = NULL
    WHERE "id" = ${FINAL_MATCH_ID}
  `);
  revision = await expectEpochChanged(revision, 'Glasgow competitionId move out');
  invariant(!(await directoryVisible()), 'moving a Glasgow Match out did not remove publication');

  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."Match"
    SET "competitionId" = ${COMPETITION_ID}, "stageId" = 'rehearsal-stage-medal-matches', "stageGroupId" = NULL
    WHERE "id" = ${FINAL_MATCH_ID}
  `);
  revision = await expectEpochChanged(revision, 'Glasgow competitionId move back');
  invariant(await directoryVisible(), 'moving a Match back into Glasgow did not restore publication');

  await prisma.$executeRaw(Prisma.sql`DELETE FROM public."Match" WHERE "id" = ${FINAL_MATCH_ID}`);
  revision = await expectEpochChanged(revision, '38-to-37 Match DELETE');
  invariant(!(await directoryVisible()), '37-match Glasgow fixture remained published after deletion');

  const ordinaryWriteRevision = revision;
  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."Match"
    SET "scheduledAt" = "scheduledAt" + INTERVAL '1 minute'
    WHERE "id" = 'rehearsal-match-37'
  `);
  revision = await expectEpochUnchanged(ordinaryWriteRevision, 'ineligible Glasgow schedule polling update');
  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."Match"
    SET "homeScore" = "homeScore", "updatedAt" = "updatedAt"
    WHERE "id" = 'rehearsal-match-37'
  `);
  revision = await expectEpochUnchanged(revision, 'no-op and updatedAt-only Match update');
}

async function runCoverageScenarios() {
  let revision = await readEpoch();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public."DataCoverage" ("id", "competitionId", "matchId", "capability", "state")
    VALUES (
      ${COVERAGE_ID}, ${COMPETITION_ID}, ${ELIGIBLE_MATCH_ID},
      'PLAYER_BOX_SCORE'::public."DataCapability", 'AVAILABLE'::public."CoverageState"
    )
  `);
  revision = await expectEpochChanged(revision, 'relevant PLAYER_BOX_SCORE coverage INSERT');

  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."DataCoverage"
    SET "state" = "state"
    WHERE "id" = ${COVERAGE_ID}
  `);
  revision = await expectEpochUnchanged(revision, 'no-op relevant coverage UPDATE');

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public."DataCoverage" ("id", "competitionId", "matchId", "capability", "state")
    VALUES (
      ${IRRELEVANT_COVERAGE_ID}, ${COMPETITION_ID}, ${ELIGIBLE_MATCH_ID},
      'FINAL_SCORE'::public."DataCapability", 'AVAILABLE'::public."CoverageState"
    )
  `);
  revision = await expectEpochUnchanged(revision, 'irrelevant FINAL_SCORE coverage INSERT');

  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."DataCoverage"
    SET "capability" = 'PERIOD_SCORES'::public."DataCapability"
    WHERE "id" = ${IRRELEVANT_COVERAGE_ID}
  `);
  revision = await expectEpochUnchanged(revision, 'irrelevant PERIOD_SCORES coverage UPDATE');

  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."DataCoverage"
    SET "state" = 'PARTIAL'::public."CoverageState"
    WHERE "id" = ${COVERAGE_ID}
  `);
  revision = await expectEpochChanged(revision, 'relevant coverage state UPDATE');

  await prisma.$executeRaw(Prisma.sql`DELETE FROM public."DataCoverage" WHERE "id" = ${COVERAGE_ID}`);
  await expectEpochChanged(revision, 'relevant coverage DELETE');
}

async function runStatsScenarios() {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public."Player" ("id", "name", "position", "teamId")
    VALUES (${PLAYER_ID}, 'Rehearsal Player', 'C'::public."Position", 'rehearsal-team-01')
  `);

  let revision = await readEpoch();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public."PlayerMatchStats" ("id", "playerId", "matchId", "goals", "minutesPlayed")
    VALUES (${PLAYER_STATS_ID}, ${PLAYER_ID}, ${ELIGIBLE_MATCH_ID}, 0, 60)
  `);
  revision = await expectEpochChanged(revision, 'PlayerMatchStats INSERT');

  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."PlayerMatchStats"
    SET "goals" = "goals"
    WHERE "id" = ${PLAYER_STATS_ID}
  `);
  revision = await expectEpochUnchanged(revision, 'identical PlayerMatchStats UPDATE');

  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."PlayerMatchStats"
    SET "goals" = 1
    WHERE "id" = ${PLAYER_STATS_ID}
  `);
  revision = await expectEpochChanged(revision, 'changed PlayerMatchStats UPDATE');

  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."PlayerMatchStats"
    SET "matchId" = ${SECOND_ELIGIBLE_MATCH_ID}
    WHERE "id" = ${PLAYER_STATS_ID}
  `);
  revision = await expectEpochChanged(revision, 'PlayerMatchStats matchId move');

  await prisma.$executeRaw(Prisma.sql`DELETE FROM public."PlayerMatchStats" WHERE "id" = ${PLAYER_STATS_ID}`);
  revision = await expectEpochChanged(revision, 'PlayerMatchStats DELETE');

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public."TeamMatchStats" ("id", "matchId", "teamId", "isHome", "goals")
    VALUES (${TEAM_STATS_ID}, ${ELIGIBLE_MATCH_ID}, 'rehearsal-team-01', true, 0)
  `);
  revision = await expectEpochChanged(revision, 'TeamMatchStats INSERT');

  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."TeamMatchStats"
    SET "goals" = "goals"
    WHERE "id" = ${TEAM_STATS_ID}
  `);
  revision = await expectEpochUnchanged(revision, 'identical TeamMatchStats UPDATE');

  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."TeamMatchStats"
    SET "goals" = 1
    WHERE "id" = ${TEAM_STATS_ID}
  `);
  revision = await expectEpochChanged(revision, 'changed TeamMatchStats UPDATE');

  await prisma.$executeRaw(Prisma.sql`DELETE FROM public."TeamMatchStats" WHERE "id" = ${TEAM_STATS_ID}`);
  await expectEpochChanged(revision, 'TeamMatchStats DELETE');
}

async function verifyPrivateContracts() {
  const [server] = await prisma.$queryRaw<Array<{ version: string }>>(Prisma.sql`
    SELECT current_setting('server_version') AS version
  `);
  invariant(server.version.startsWith('17.'), `expected PostgreSQL 17, found ${server.version}`);

  const [epoch] = await prisma.$queryRaw<Array<{ singleton_count: bigint; rls: boolean }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS singleton_count,
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'analytics.cache_epoch'::regclass) AS rls
    FROM analytics.cache_epoch
    WHERE singleton_id = true
  `);
  invariant(epoch.singleton_count === BigInt(1) && epoch.rls,
    'global epoch does not have one singleton row with RLS enabled');

  const columns = await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`
    SELECT attname AS name
    FROM pg_attribute
    WHERE attrelid = 'analytics.cache_revision_read'::regclass
      AND attnum > 0 AND NOT attisdropped
    ORDER BY attnum
  `);
  invariant(JSON.stringify(columns.map((column) => column.name)) ===
    JSON.stringify(['revision', 'invalidated_at', 'contract_version']),
  'cache_revision_read does not expose the exact v1 discriminator surface');

  const [acl] = await prisma.$queryRaw<Array<{
    epochAnon: boolean;
    epochAuthenticated: boolean;
    epochServiceRole: boolean;
    viewAnon: boolean;
    viewAuthenticated: boolean;
    viewServiceRole: boolean;
    snapshotAnon: boolean;
    snapshotAuthenticated: boolean;
    snapshotServiceRole: boolean;
    recordAnon: boolean;
    recordAuthenticated: boolean;
    recordServiceRole: boolean;
    functionAnon: boolean;
    functionAuthenticated: boolean;
    functionServiceRole: boolean;
  }>>(Prisma.sql`
    SELECT
      has_table_privilege('anon', 'analytics.cache_epoch', 'SELECT') AS "epochAnon",
      has_table_privilege('authenticated', 'analytics.cache_epoch', 'SELECT') AS "epochAuthenticated",
      has_table_privilege('service_role', 'analytics.cache_epoch', 'SELECT') AS "epochServiceRole",
      has_table_privilege('anon', 'analytics.cache_revision_read', 'SELECT') AS "viewAnon",
      has_table_privilege('authenticated', 'analytics.cache_revision_read', 'SELECT') AS "viewAuthenticated",
      has_table_privilege('service_role', 'analytics.cache_revision_read', 'SELECT') AS "viewServiceRole",
      has_table_privilege('anon', 'analytics.ranking_snapshot', 'SELECT') AS "snapshotAnon",
      has_table_privilege('authenticated', 'analytics.ranking_snapshot', 'SELECT') AS "snapshotAuthenticated",
      has_table_privilege('service_role', 'analytics.ranking_snapshot', 'SELECT') AS "snapshotServiceRole",
      has_table_privilege('anon', 'analytics.record_entry', 'SELECT') AS "recordAnon",
      has_table_privilege('authenticated', 'analytics.record_entry', 'SELECT') AS "recordAuthenticated",
      has_table_privilege('service_role', 'analytics.record_entry', 'SELECT') AS "recordServiceRole",
      has_function_privilege('anon', 'analytics.advance_cache_epoch()', 'EXECUTE') AS "functionAnon",
      has_function_privilege('authenticated', 'analytics.advance_cache_epoch()', 'EXECUTE') AS "functionAuthenticated",
      has_function_privilege('service_role', 'analytics.advance_cache_epoch()', 'EXECUTE') AS "functionServiceRole"
  `);
  invariant(Object.values(acl).every((value) => value === false),
    'a Data API compatibility role can access a private analytics object');

  const [functionContract] = await prisma.$queryRaw<Array<{
    securityDefiner: boolean;
    config: string[] | null;
  }>>(Prisma.sql`
    SELECT prosecdef AS "securityDefiner", proconfig AS config
    FROM pg_proc
    WHERE oid = 'analytics.advance_cache_epoch()'::regprocedure
  `);
  invariant(functionContract.securityDefiner &&
    (functionContract.config ?? []).some((value) => value.startsWith('search_path=')),
  'epoch function is not SECURITY DEFINER with an explicit empty search_path');

  const [triggerContract] = await prisma.$queryRaw<Array<{ enabled_count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS enabled_count
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN (
        'analytics_match_finalization_invalidation',
        'analytics_player_stats_invalidation',
        'analytics_team_stats_invalidation',
        'analytics_competition_series_cache_invalidation',
        'analytics_competition_cache_invalidation',
        'analytics_stage_cache_invalidation',
        'analytics_stage_group_cache_invalidation',
        'analytics_edition_entry_cache_invalidation',
        'analytics_roster_membership_cache_invalidation',
        'analytics_player_cache_invalidation',
        'analytics_team_cache_invalidation',
        'analytics_data_coverage_cache_invalidation',
        'analytics_import_run_cache_invalidation',
        'analytics_source_system_cache_invalidation',
        'analytics_match_slot_cache_invalidation'
      )
      AND tgenabled = 'O'
  `);
  invariant(triggerContract.enabled_count === BigInt(15),
    `expected 15 enabled private invalidation triggers, found ${triggerContract.enabled_count}`);
}

async function main() {
  verifyLocalTarget();
  await seedPublishedGlasgowFixture();
  await runStructuralScenarios();
  await runCoverageScenarios();
  await runStatsScenarios();
  await verifyPrivateContracts();
  const [ledger] = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"
  `);
  invariant(ledger.count === BigInt(16),
    `expected the historical baseline plus 15 retained migrations, found ${ledger.count}`);
  console.log(JSON.stringify({
    status: 'rehearsed-analytics-cache-epoch-on-postgresql-17',
    migrationLedgerRows: Number(ledger.count),
    structuralTransitions: ['37-to-38', '38-to-39', '39-to-38', 'stage-count', 'competitionId-move', '38-to-37'],
    coverageTransitions: ['relevant-insert', 'same-row-no-op', 'irrelevant-insert', 'irrelevant-update', 'relevant-update', 'relevant-delete'],
    statsTransitions: ['identical-update-no-op', 'changed-update', 'matchId-move', 'delete'],
    productionMutation: false,
  }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
