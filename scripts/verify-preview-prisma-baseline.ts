import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { verifyPreviewDatabaseTarget } from './lib/preview-database-target';

const INITIAL_MIGRATION = '20260602_expand_stats_fields';

interface ColumnRow {
  name: string;
  dataType: string;
  isNullable: 'YES' | 'NO';
  defaultValue: string | null;
}

interface DefinitionRow {
  name: string;
  definition: string;
}

interface CountRow {
  count: bigint;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Preview Prisma baseline verification failed: ${message}`);
}

interface ExpectedColumn {
  name: string;
  dataType: string;
  isNullable: 'YES' | 'NO';
  defaultValue: string | null;
}

const POSTGRES_TYPES: Record<string, string> = {
  BOOLEAN: 'boolean',
  'DOUBLE PRECISION': 'double precision',
  INTEGER: 'integer',
  TEXT: 'text',
};

function parseColumn(name: string, declaration: string): ExpectedColumn {
  const type = Object.keys(POSTGRES_TYPES).find((candidate) => declaration.startsWith(candidate));
  invariant(type, `unsupported column type for ${name}: ${declaration}`);
  const defaultMatch = declaration.match(/\bDEFAULT\s+([^\s,]+)/);
  return {
    name,
    dataType: POSTGRES_TYPES[type],
    isNullable: declaration.includes('NOT NULL') ? 'NO' : 'YES',
    defaultValue: defaultMatch?.[1] ?? null,
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
      `${table}.${expectedColumn.name} type is ${actualColumn.dataType}, expected ${expectedColumn.dataType}`);
    invariant(actualColumn.isNullable === expectedColumn.isNullable,
      `${table}.${expectedColumn.name} nullability does not match the migration`);
    invariant(actualColumn.defaultValue === expectedColumn.defaultValue,
      `${table}.${expectedColumn.name} default does not match the migration`);
  }
}

async function expectedMigrationEffects() {
  const sql = await readFile(path.resolve(
    'prisma/migrations',
    INITIAL_MIGRATION,
    'migration.sql',
  ), 'utf8');
  const playerColumns = [...sql.matchAll(
    /ALTER TABLE "PlayerMatchStats" ADD COLUMN "([^"]+)" ([^;]+);/g,
  )].map((match) => parseColumn(match[1], match[2]));
  const teamTable = sql.match(/CREATE TABLE "TeamMatchStats" \(([\s\S]*?)\n\);/);
  invariant(teamTable, 'initial migration does not declare TeamMatchStats');
  const teamColumns = [...teamTable[1].matchAll(
    /^\s+"([^"]+)"\s+((?:DOUBLE PRECISION|BOOLEAN|INTEGER|TEXT)[^,]*),?$/gm,
  )].map((match) => parseColumn(match[1], match[2]));
  invariant(playerColumns.length > 0, 'initial migration has no PlayerMatchStats additions');
  invariant(teamColumns.length > 0, 'initial migration has no TeamMatchStats columns');
  return { playerColumns, teamColumns };
}

async function main() {
  const target = verifyPreviewDatabaseTarget();
  const expected = await expectedMigrationEffects();
  const [ledger, playerColumns, teamColumns, constraints, indexes] = await Promise.all([
    prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"
    `),
    prisma.$queryRaw<ColumnRow[]>(Prisma.sql`
      SELECT
        column_name AS name,
        data_type AS "dataType",
        is_nullable AS "isNullable",
        column_default AS "defaultValue"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'PlayerMatchStats'
        AND column_name IN (${Prisma.join(expected.playerColumns.map((column) => column.name))})
      ORDER BY column_name
    `),
    prisma.$queryRaw<ColumnRow[]>(Prisma.sql`
      SELECT
        column_name AS name,
        data_type AS "dataType",
        is_nullable AS "isNullable",
        column_default AS "defaultValue"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'TeamMatchStats'
      ORDER BY column_name
    `),
    prisma.$queryRaw<DefinitionRow[]>(Prisma.sql`
      SELECT conname AS name, pg_get_constraintdef(oid, true) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public."TeamMatchStats"'::regclass
      ORDER BY conname
    `),
    prisma.$queryRaw<DefinitionRow[]>(Prisma.sql`
      SELECT indexname AS name, indexdef AS definition
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'TeamMatchStats_matchId_teamId_key',
          'ScoreFlow_matchId_period_periodSeconds_scoringTeamId_key',
          'ScoreFlow_matchId_period_periodSeconds_key'
        )
      ORDER BY indexname
    `),
  ]);

  invariant(ledger[0]?.count === BigInt(0),
    'expected an empty Prisma ledger before resolving the Supabase remote-schema baseline');
  assertExactColumns(playerColumns, expected.playerColumns, 'PlayerMatchStats');
  assertExactColumns(teamColumns, expected.teamColumns, 'TeamMatchStats');
  const expectedConstraints = new Map([
    ['TeamMatchStats_pkey', 'PRIMARY KEY (id)'],
    ['TeamMatchStats_matchId_fkey',
      'FOREIGN KEY ("matchId") REFERENCES "Match"(id) ON UPDATE CASCADE ON DELETE RESTRICT'],
    ['TeamMatchStats_teamId_fkey',
      'FOREIGN KEY ("teamId") REFERENCES "Team"(id) ON UPDATE CASCADE ON DELETE RESTRICT'],
  ]);
  invariant(constraints.length === expectedConstraints.size,
    `TeamMatchStats expected ${expectedConstraints.size} constraints, found ${constraints.length}`);
  for (const constraint of constraints) {
    invariant(expectedConstraints.get(constraint.name) === constraint.definition,
      `TeamMatchStats constraint ${constraint.name} does not exactly match the migration`);
  }
  const indexByName = new Map(indexes.map((row) => [row.name, row.definition]));
  invariant(indexByName.get('TeamMatchStats_matchId_teamId_key') ===
    'CREATE UNIQUE INDEX "TeamMatchStats_matchId_teamId_key" ON public."TeamMatchStats" USING btree ("matchId", "teamId")',
  'TeamMatchStats unique index does not exactly match the migration');
  invariant(indexByName.get('ScoreFlow_matchId_period_periodSeconds_scoringTeamId_key') ===
    'CREATE UNIQUE INDEX "ScoreFlow_matchId_period_periodSeconds_scoringTeamId_key" ON public."ScoreFlow" USING btree ("matchId", period, "periodSeconds", "scoringTeamId")',
  'replacement ScoreFlow unique index does not exactly match the migration');
  invariant(!indexByName.has('ScoreFlow_matchId_period_periodSeconds_key'),
    'obsolete ScoreFlow unique index is still present');

  console.log(JSON.stringify({
    status: 'verified-untracked-supabase-remote-schema-baseline',
    expectedPreviewProjectRef: target.expectedPreviewProjectRef,
    productionProjectRef: target.productionProjectRef,
    prismaLedgerRows: 0,
    migrationToResolve: INITIAL_MIGRATION,
    verifiedPlayerColumns: expected.playerColumns.length,
    verifiedTeamColumns: expected.teamColumns.length,
    verifiedConstraints: 3,
    verifiedIndexes: 2,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
