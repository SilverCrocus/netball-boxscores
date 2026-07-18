#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runProtectedPsql } from './lib/production-psql';

export interface MigrationDefinition {
  name: string;
  checksum: string;
}

export interface ProductionMigrationRecord extends MigrationDefinition {
  status: 'applied' | 'rolled_back' | 'incomplete';
}

export interface MigrationComparison {
  passed: boolean;
  mode: 'predeploy' | 'postdeploy';
  appliedProductionCount: number;
  localCount: number;
  pendingLocal: string[];
  unknownProduction: string[];
  changedProduction: string[];
  unexpectedPending: string[];
  missingExpectedPending: string[];
  nonAppliedProduction: string[];
  duplicateProduction: string[];
}

const LEDGER_SQL = String.raw`
SELECT concat_ws(
  E'\t',
  replace(encode(convert_to(migration_name, 'UTF8'), 'base64'), E'\n', ''),
  checksum,
  CASE
    WHEN finished_at IS NOT NULL AND rolled_back_at IS NULL THEN 'applied'
    WHEN rolled_back_at IS NOT NULL THEN 'rolled_back'
    ELSE 'incomplete'
  END
)
FROM public."_prisma_migrations"
ORDER BY started_at, migration_name;
`;

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function compareMigrationState(
  mode: 'predeploy' | 'postdeploy',
  local: MigrationDefinition[],
  production: ProductionMigrationRecord[],
  expectedPending: string[],
): MigrationComparison {
  const localByName = new Map(local.map((migration) => [migration.name, migration]));
  const productionNameCounts = new Map<string, number>();
  for (const migration of production) {
    productionNameCounts.set(migration.name, (productionNameCounts.get(migration.name) ?? 0) + 1);
  }
  const duplicateProduction = sortedUnique(
    [...productionNameCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
  );
  const nonAppliedProduction = production
    .filter((migration) => migration.status !== 'applied')
    .map((migration) => `${migration.name}:${migration.status}`)
    .sort((left, right) => left.localeCompare(right));
  const appliedProduction = production.filter((migration) => migration.status === 'applied');
  const unknownProduction = sortedUnique(
    appliedProduction
      .filter((migration) => !localByName.has(migration.name))
      .map((migration) => migration.name),
  );
  const changedProduction = sortedUnique(
    appliedProduction
      .filter((migration) => {
        const localMigration = localByName.get(migration.name);
        return localMigration !== undefined && localMigration.checksum !== migration.checksum;
      })
      .map((migration) => migration.name),
  );
  const appliedNames = new Set(appliedProduction.map((migration) => migration.name));
  const pendingLocal = local
    .filter((migration) => !appliedNames.has(migration.name))
    .map((migration) => migration.name)
    .sort((left, right) => left.localeCompare(right));
  const expectedPendingSet = new Set(expectedPending);
  const unexpectedPending = pendingLocal.filter((name) => !expectedPendingSet.has(name));
  const pendingLocalSet = new Set(pendingLocal);
  const missingExpectedPending = sortedUnique(
    expectedPending.filter((name) => !pendingLocalSet.has(name)),
  );

  const passed = unknownProduction.length === 0
    && changedProduction.length === 0
    && duplicateProduction.length === 0
    && nonAppliedProduction.length === 0
    && unexpectedPending.length === 0
    && missingExpectedPending.length === 0
    && (mode !== 'postdeploy' || pendingLocal.length === 0);

  return {
    passed,
    mode,
    appliedProductionCount: appliedProduction.length,
    localCount: local.length,
    pendingLocal,
    unknownProduction,
    changedProduction,
    unexpectedPending,
    missingExpectedPending,
    nonAppliedProduction,
    duplicateProduction,
  };
}

export async function readLocalMigrations(migrationsDirectory: string): Promise<MigrationDefinition[]> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const migrations: MigrationDefinition[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const migrationPath = path.join(migrationsDirectory, entry.name, 'migration.sql');
    const contents = await readFile(migrationPath);
    migrations.push({
      name: entry.name,
      checksum: createHash('sha256').update(contents).digest('hex'),
    });
  }
  return migrations.sort((left, right) => left.name.localeCompare(right.name));
}

export function parseProductionMigrationLedger(output: string): ProductionMigrationRecord[] {
  if (!output.trim()) return [];
  return output.trim().split('\n').map((line) => {
    const [encodedName, checksum, status, ...extra] = line.split('\t');
    if (!encodedName || !checksum || !status || extra.length > 0) {
      throw new Error('production migration ledger returned an invalid row');
    }
    const name = Buffer.from(encodedName, 'base64').toString('utf8');
    if (!name || /[\r\n]/.test(name) || !/^[a-f0-9]{64}$/i.test(checksum)) {
      throw new Error('production migration ledger returned invalid migration data');
    }
    if (!['applied', 'rolled_back', 'incomplete'].includes(status)) {
      throw new Error('production migration ledger returned an invalid status');
    }
    return {
      name,
      checksum: checksum.toLowerCase(),
      status: status as ProductionMigrationRecord['status'],
    };
  });
}

async function readExpectedPending(filePath: string): Promise<string[]> {
  const contents = await readFile(filePath, 'utf8');
  return sortedUnique(contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')));
}

function parseArguments(argv: string[]): {
  mode: 'predeploy' | 'postdeploy';
  expectedPendingFile?: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error('Usage: npm run verify:production-migrations -- --mode predeploy --expected-pending <FILE> | --mode postdeploy');
    }
    if (!['--mode', '--expected-pending'].includes(key)) throw new Error(`Unknown argument: ${key}`);
    if (values.has(key)) throw new Error(`Duplicate argument: ${key}`);
    values.set(key, value);
  }
  const mode = values.get('--mode');
  if (mode !== 'predeploy' && mode !== 'postdeploy') throw new Error('--mode must be predeploy or postdeploy');
  const expectedPendingFile = values.get('--expected-pending');
  if (mode === 'predeploy' && !expectedPendingFile) {
    throw new Error('--expected-pending is required in predeploy mode, including for an intentionally empty file');
  }
  if (mode === 'postdeploy' && expectedPendingFile) {
    throw new Error('--expected-pending is not allowed in postdeploy mode');
  }
  return { mode, expectedPendingFile };
}

async function main(): Promise<void> {
  const { mode, expectedPendingFile } = parseArguments(process.argv.slice(2));
  const migrationsDirectory = path.resolve('prisma/migrations');
  const local = await readLocalMigrations(migrationsDirectory);
  const production = parseProductionMigrationLedger(runProtectedPsql(LEDGER_SQL));
  const expectedPending = expectedPendingFile
    ? await readExpectedPending(path.resolve(expectedPendingFile))
    : [];
  const comparison = compareMigrationState(mode, local, production, expectedPending);
  console.log(JSON.stringify({
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    service: process.env.PGSERVICE,
    expectedPending,
    ...comparison,
  }, null, 2));
  if (!comparison.passed) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
