import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { verifyPreviewDatabaseTarget } from './lib/preview-database-target';

interface MigrationLedgerRow {
  migrationName: string;
  checksum: string;
  finishedAt: Date | null;
  rolledBackAt: Date | null;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Preview migration verification failed: ${message}`);
}

async function localMigrations() {
  const migrationRoot = path.resolve('prisma/migrations');
  const entries = await readdir(migrationRoot, { withFileTypes: true });
  const migrations = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && /^\d+_[a-z0-9_]+$/.test(entry.name))
    .map(async (entry) => {
      const sql = await readFile(path.join(migrationRoot, entry.name, 'migration.sql'));
      return {
        migrationName: entry.name,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    }));
  return migrations.toSorted((left, right) =>
    left.migrationName.localeCompare(right.migrationName));
}

async function main() {
  const target = verifyPreviewDatabaseTarget();
  const [local, applied] = await Promise.all([
    localMigrations(),
    prisma.$queryRaw<MigrationLedgerRow[]>(Prisma.sql`
      SELECT
        migration_name AS "migrationName",
        checksum,
        finished_at AS "finishedAt",
        rolled_back_at AS "rolledBackAt"
      FROM "_prisma_migrations"
      ORDER BY migration_name
    `),
  ]);

  invariant(applied.length === local.length,
    `expected ${local.length} ledger rows, found ${applied.length}`);
  const appliedByName = new Map(applied.map((migration) => [migration.migrationName, migration]));
  for (const expected of local) {
    const actual = appliedByName.get(expected.migrationName);
    invariant(actual, `missing checked-in migration ${expected.migrationName}`);
    invariant(actual.finishedAt !== null, `${expected.migrationName} is unfinished`);
    invariant(actual.rolledBackAt === null, `${expected.migrationName} is rolled back`);
    invariant(actual.checksum === expected.checksum,
      `${expected.migrationName} checksum does not match the checked-in SQL`);
  }
  const localNames = new Set(local.map((migration) => migration.migrationName));
  invariant(applied.every((migration) => localNames.has(migration.migrationName)),
    'the Prisma ledger contains an untracked migration');

  console.log(JSON.stringify({
    status: 'verified-checked-in-preview-migrations',
    expectedPreviewProjectRef: target.expectedPreviewProjectRef,
    productionProjectRef: target.productionProjectRef,
    migrationCount: local.length,
    migrations: local.map((migration) => migration.migrationName),
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
