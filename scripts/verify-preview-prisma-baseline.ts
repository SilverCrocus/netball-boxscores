import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  type IndexSemantics,
  matchesPlainBtreeIndex,
} from './lib/preview-index-contract';
import { verifyPreviewDatabaseTarget } from './lib/preview-database-target';

const BASELINED_MIGRATIONS = [
  '20260602_expand_stats_fields',
  '20260712000000_add_hot_query_indexes',
  '20260712010000_harden_public_schema',
  '20260712020000_add_finals_match_metadata',
] as const;
const FIRST_UNAPPLIED_MIGRATION = '20260715000000_add_competition_foundation';

interface ColumnRow { name: string; dataType: string; isNullable: 'YES' | 'NO'; defaultValue: string | null }
interface DefinitionRow { name: string; definition: string }
interface CountRow { count: bigint }
interface PolicyRow extends DefinitionRow { command: string; checkExpression: string; roles: string[] }
interface RlsRow { name: string; enabled: boolean; forced: boolean }
interface GrantCounts { tableGrants: bigint; sequenceGrants: bigint; routineGrants: bigint; defaultGrants: bigint }
interface ExpectedColumn { name: string; dataType: string; isNullable: 'YES' | 'NO'; defaultValue: string | null }

const POSTGRES_TYPES: Record<string, string> = {
  BOOLEAN: 'boolean',
  'DOUBLE PRECISION': 'double precision',
  INTEGER: 'integer',
  TEXT: 'text',
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Preview Prisma baseline verification failed: ${message}`);
}

function parseColumn(name: string, declaration: string): ExpectedColumn {
  const type = Object.keys(POSTGRES_TYPES).find((candidate) => declaration.startsWith(candidate));
  invariant(type, `unsupported column type for ${name}: ${declaration}`);
  return {
    name,
    dataType: POSTGRES_TYPES[type],
    isNullable: declaration.includes('NOT NULL') ? 'NO' : 'YES',
    defaultValue: declaration.match(/\bDEFAULT\s+([^\s,]+)/)?.[1] ?? null,
  };
}

function assertExactColumns(actual: ColumnRow[], expected: ExpectedColumn[], table: string) {
  const actualByName = new Map(actual.map((column) => [column.name, column]));
  invariant(actual.length === expected.length,
    `${table} expected ${expected.length} migration columns, found ${actual.length}`);
  for (const expectedColumn of expected) {
    const actualColumn = actualByName.get(expectedColumn.name);
    invariant(actualColumn, `${table}.${expectedColumn.name} is missing`);
    invariant(actualColumn.dataType === expectedColumn.dataType,
      `${table}.${expectedColumn.name} type does not match the migration`);
    invariant(actualColumn.isNullable === expectedColumn.isNullable,
      `${table}.${expectedColumn.name} nullability does not match the migration`);
    invariant(actualColumn.defaultValue === expectedColumn.defaultValue,
      `${table}.${expectedColumn.name} default does not match the migration`);
  }
}

async function migrationSql(name: string) {
  return readFile(path.resolve('prisma/migrations', name, 'migration.sql'), 'utf8');
}

async function verifyContiguousOrder() {
  const entries = await readdir(path.resolve('prisma/migrations'), { withFileTypes: true });
  const names = entries.filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
    .map((entry) => entry.name).toSorted();
  invariant(JSON.stringify(names.slice(0, BASELINED_MIGRATIONS.length)) ===
    JSON.stringify(BASELINED_MIGRATIONS), 'materialized migrations are not a checked-in contiguous prefix');
  invariant(names[BASELINED_MIGRATIONS.length] === FIRST_UNAPPLIED_MIGRATION,
    `expected ${FIRST_UNAPPLIED_MIGRATION} immediately after the materialized prefix`);
}

async function verifyInitialMigration() {
  const sql = await migrationSql(BASELINED_MIGRATIONS[0]);
  const playerColumns = [...sql.matchAll(
    /ALTER TABLE "PlayerMatchStats" ADD COLUMN "([^"]+)" ([^;]+);/g,
  )].map((match) => parseColumn(match[1], match[2]));
  const teamTable = sql.match(/CREATE TABLE "TeamMatchStats" \(([\s\S]*?)\n\);/);
  invariant(teamTable, 'initial migration does not declare TeamMatchStats');
  const teamColumns = [...teamTable[1].matchAll(
    /^\s+"([^"]+)"\s+((?:DOUBLE PRECISION|BOOLEAN|INTEGER|TEXT)[^,]*),?$/gm,
  )].map((match) => parseColumn(match[1], match[2]));
  const [actualPlayer, actualTeam, constraints, indexes] = await Promise.all([
    prisma.$queryRaw<ColumnRow[]>(Prisma.sql`
      SELECT column_name AS name, data_type AS "dataType", is_nullable AS "isNullable",
        column_default AS "defaultValue"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'PlayerMatchStats'
        AND column_name IN (${Prisma.join(playerColumns.map((column) => column.name))})
      ORDER BY column_name`),
    prisma.$queryRaw<ColumnRow[]>(Prisma.sql`
      SELECT column_name AS name, data_type AS "dataType", is_nullable AS "isNullable",
        column_default AS "defaultValue"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'TeamMatchStats' ORDER BY column_name`),
    prisma.$queryRaw<DefinitionRow[]>(Prisma.sql`
      SELECT conname AS name, pg_get_constraintdef(oid, true) AS definition
      FROM pg_constraint WHERE conrelid = 'public."TeamMatchStats"'::regclass ORDER BY conname`),
    prisma.$queryRaw<DefinitionRow[]>(Prisma.sql`
      SELECT indexname AS name, indexdef AS definition FROM pg_indexes
      WHERE schemaname = 'public' AND indexname IN (
        'TeamMatchStats_matchId_teamId_key',
        'ScoreFlow_matchId_period_periodSeconds_scoringTeamId_key',
        'ScoreFlow_matchId_period_periodSeconds_key') ORDER BY indexname`),
  ]);
  assertExactColumns(actualPlayer, playerColumns, 'PlayerMatchStats');
  assertExactColumns(actualTeam, teamColumns, 'TeamMatchStats');
  const expectedConstraints = new Map([
    ['TeamMatchStats_pkey', 'PRIMARY KEY (id)'],
    ['TeamMatchStats_matchId_fkey',
      'FOREIGN KEY ("matchId") REFERENCES "Match"(id) ON UPDATE CASCADE ON DELETE RESTRICT'],
    ['TeamMatchStats_teamId_fkey',
      'FOREIGN KEY ("teamId") REFERENCES "Team"(id) ON UPDATE CASCADE ON DELETE RESTRICT'],
  ]);
  invariant(constraints.length === expectedConstraints.size, 'TeamMatchStats constraint count differs');
  for (const row of constraints) invariant(expectedConstraints.get(row.name) === row.definition,
    `TeamMatchStats constraint ${row.name} differs`);
  const indexByName = new Map(indexes.map((row) => [row.name, row.definition]));
  invariant(indexByName.get('TeamMatchStats_matchId_teamId_key') ===
    'CREATE UNIQUE INDEX "TeamMatchStats_matchId_teamId_key" ON public."TeamMatchStats" USING btree ("matchId", "teamId")',
  'TeamMatchStats unique index differs');
  invariant(indexByName.get('ScoreFlow_matchId_period_periodSeconds_scoringTeamId_key') ===
    'CREATE UNIQUE INDEX "ScoreFlow_matchId_period_periodSeconds_scoringTeamId_key" ON public."ScoreFlow" USING btree ("matchId", period, "periodSeconds", "scoringTeamId")',
  'replacement ScoreFlow unique index differs');
  invariant(!indexByName.has('ScoreFlow_matchId_period_periodSeconds_key'),
    'obsolete ScoreFlow unique index remains');
}

async function verifyHotIndexes() {
  const sql = await migrationSql(BASELINED_MIGRATIONS[1]);
  const expected = [...sql.matchAll(
    /CREATE INDEX "([^"]+)"\s+ON "([^"]+)"\(([^)]+)\);/g,
  )].map((match) => ({
    name: match[1],
    tableName: match[2],
    columns: match[3].split(',').map((column) => column.trim().replaceAll('"', '')),
  }));
  invariant(expected.length > 0, 'hot-index migration contains no indexes');
  const actual = await prisma.$queryRaw<IndexSemantics[]>(Prisma.sql`
    SELECT idx.relname AS name, tbl.relname AS "tableName", i.indisunique AS unique,
      i.indisvalid AS valid, i.indisready AS ready, i.indislive AS live,
      i.indisexclusion AS exclusion, i.indisclustered AS clustered,
      i.indnullsnotdistinct AS "nullsNotDistinct", am.amname AS method,
      ARRAY(SELECT attribute.attname
        FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, position)
        JOIN pg_attribute attribute ON attribute.attrelid = i.indrelid
          AND attribute.attnum = key.attnum
        WHERE key.position <= i.indnkeyatts ORDER BY key.position) AS columns,
      pg_get_expr(i.indpred, i.indrelid) AS predicate,
      EXISTS(SELECT 1 FROM unnest(i.indkey) AS key(attnum) WHERE key.attnum = 0)
        AS "hasExpressions",
      i.indnatts <> i.indnkeyatts AS "hasIncludedColumns",
      EXISTS(SELECT 1 FROM unnest(i.indoption) AS option(value) WHERE option.value <> 0)
        AS "hasNondefaultSortOptions",
      EXISTS(SELECT 1 FROM unnest(i.indclass) AS operator_class(oid)
        JOIN pg_opclass opc ON opc.oid = operator_class.oid WHERE NOT opc.opcdefault)
        AS "hasNondefaultOperatorClasses",
      EXISTS(SELECT 1
        FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, position)
        JOIN pg_attribute attribute ON attribute.attrelid = i.indrelid
          AND attribute.attnum = key.attnum
        JOIN unnest(i.indcollation) WITH ORDINALITY AS index_collation(oid, position)
          USING (position)
        WHERE key.position <= i.indnkeyatts AND index_collation.oid <> attribute.attcollation)
        AS "hasNondefaultCollations"
    FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class tbl ON tbl.oid = i.indrelid JOIN pg_namespace n ON n.oid = tbl.relnamespace
    JOIN pg_am am ON am.oid = idx.relam
    WHERE n.nspname = 'public' AND idx.relname IN (${Prisma.join(expected.map((row) => row.name))})
    ORDER BY idx.relname`);
  const actualByName = new Map(actual.map((row) => [row.name, row]));
  invariant(actual.length === expected.length, 'hot-index count differs from the migration');
  for (const row of expected) {
    const index = actualByName.get(row.name);
    invariant(matchesPlainBtreeIndex(index, row),
    `index ${row.name} does not exactly match the migration semantics`);
  }
}

async function verifyPublicSchemaHardening() {
  const sql = await migrationSql(BASELINED_MIGRATIONS[2]);
  const tables = [...sql.matchAll(/ALTER TABLE "([^"]+)" ENABLE ROW LEVEL SECURITY;/g)]
    .map((match) => match[1]).toSorted();
  const [rls, policies, key, grants] = await Promise.all([
    prisma.$queryRaw<RlsRow[]>(Prisma.sql`
      SELECT c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN (${Prisma.join(tables)}) ORDER BY c.relname`),
    prisma.$queryRaw<PolicyRow[]>(Prisma.sql`
      SELECT c.relname AS name, p.polcmd AS command,
        pg_get_expr(p.polqual, p.polrelid) AS definition,
        pg_get_expr(p.polwithcheck, p.polrelid) AS "checkExpression",
        ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(p.polroles) ORDER BY rolname) AS roles
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND p.polname = 'deny_data_api_access'
        AND c.relname IN (${Prisma.join(tables)}) ORDER BY c.relname`),
    prisma.$queryRaw<DefinitionRow[]>(Prisma.sql`
      SELECT conname AS name, pg_get_constraintdef(oid, true) AS definition FROM pg_constraint
      WHERE conrelid = 'public."VerificationToken"'::regclass AND contype = 'p'`),
    prisma.$queryRaw<GrantCounts[]>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated'))::bigint AS "tableGrants",
        (SELECT COUNT(*) FROM information_schema.role_usage_grants
          WHERE object_schema = 'public' AND grantee IN ('anon', 'authenticated'))::bigint AS "sequenceGrants",
        (SELECT COUNT(*) FROM information_schema.role_routine_grants
          WHERE routine_schema = 'public' AND grantee IN ('anon', 'authenticated'))::bigint AS "routineGrants",
        (SELECT COUNT(*) FROM pg_default_acl d
          CROSS JOIN LATERAL aclexplode(d.defaclacl) a JOIN pg_roles r ON r.oid = a.grantee
          LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
          WHERE n.nspname = 'public' AND r.rolname IN ('anon', 'authenticated'))::bigint AS "defaultGrants"`),
  ]);
  invariant(rls.length === tables.length && rls.every((row) => row.enabled && !row.forced),
    'RLS state does not exactly match the hardening migration');
  invariant(policies.length === tables.length, 'deny policy count differs from the migration');
  for (const policy of policies) invariant(policy.command === '*' && policy.definition === 'false' &&
    policy.checkExpression === 'false' && JSON.stringify(policy.roles) === '["anon","authenticated"]',
  `deny policy semantics differ on ${policy.name}`);
  invariant(key.length === 1 && key[0].name === 'VerificationToken_pkey' &&
    key[0].definition === 'PRIMARY KEY (identifier, token)', 'VerificationToken primary key differs');
  invariant(Object.values(grants[0] ?? {}).every((count) => count === BigInt(0)),
    'Data API or default privileges remain after the hardening migration');
}

async function verifyFinalsColumns() {
  const sql = await migrationSql(BASELINED_MIGRATIONS[3]);
  const expected = [...sql.matchAll(/ADD COLUMN "([^"]+)" ((?:INTEGER|TEXT)[^,;]*)(?:,|;)/g)]
    .map((match) => parseColumn(match[1], match[2]));
  const actual = await prisma.$queryRaw<ColumnRow[]>(Prisma.sql`
    SELECT column_name AS name, data_type AS "dataType", is_nullable AS "isNullable",
      column_default AS "defaultValue" FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Match'
      AND column_name IN (${Prisma.join(expected.map((column) => column.name))}) ORDER BY column_name`);
  assertExactColumns(actual, expected, 'Match');
}

async function verifyFirstUnappliedMigrationAbsent() {
  const sql = await migrationSql(FIRST_UNAPPLIED_MIGRATION);
  const types = [...sql.matchAll(/CREATE TYPE "([^"]+)"/g)].map((match) => match[1]);
  const tables = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]);
  const indexes = [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g)].map((match) => match[1]);
  const constraints = [...sql.matchAll(/ADD CONSTRAINT "([^"]+)"/g)].map((match) => match[1]);
  const additions = [...sql.matchAll(/ALTER TABLE "([^"]+)"([\s\S]*?);/g)].flatMap((table) =>
    [...table[2].matchAll(/ADD COLUMN "([^"]+)"/g)].map((column) => `${table[1]}.${column[1]}`));
  const counts = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT (
      (SELECT COUNT(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname IN (${Prisma.join(types)})) +
      (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname IN (${Prisma.join(tables)})) +
      (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (${Prisma.join(indexes)})) +
      (SELECT COUNT(*) FROM pg_constraint WHERE conname IN (${Prisma.join(constraints)})) +
      (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND (table_name || '.' || column_name) IN (${Prisma.join(additions)}))
    )::bigint AS count`);
  invariant(counts[0]?.count === BigInt(0),
    `${FIRST_UNAPPLIED_MIGRATION} is partially or non-contiguously materialized`);
}

async function resolveVerifiedPrefix() {
  for (const migration of BASELINED_MIGRATIONS) {
    const result = spawnSync('npx', ['prisma', 'migrate', 'resolve', '--applied', migration], {
      env: process.env,
      stdio: 'inherit',
    });
    invariant(result.status === 0, `Prisma failed to resolve verified migration ${migration}`);
  }
}

async function main() {
  const target = verifyPreviewDatabaseTarget();
  const ledger = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"`);
  invariant(ledger[0]?.count === BigInt(0), 'expected an empty Prisma ledger on the reset snapshot');
  await verifyContiguousOrder();
  await verifyInitialMigration();
  await verifyHotIndexes();
  await verifyPublicSchemaHardening();
  await verifyFinalsColumns();
  await verifyFirstUnappliedMigrationAbsent();
  console.log(JSON.stringify({
    status: 'verified-contiguous-supabase-remote-schema-prefix',
    expectedPreviewProjectRef: target.expectedPreviewProjectRef,
    productionProjectRef: target.productionProjectRef,
    prismaLedgerRows: 0,
    materializedMigrationCount: BASELINED_MIGRATIONS.length,
    materializedMigrations: BASELINED_MIGRATIONS,
    firstUnappliedMigration: FIRST_UNAPPLIED_MIGRATION,
    firstUnappliedMigrationEffectsFound: 0,
  }, null, 2));
  if (process.argv.includes('--resolve')) await resolveVerifiedPrefix();
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
