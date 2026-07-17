import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const HISTORICAL_BASELINE_MIGRATION = '00000000000000_historical_baseline';

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Complete Prisma migration rehearsal failed: ${message}`);
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

async function main() {
  verifyLocalTarget();
  const rehearsalRoot = await mkdtemp(path.join(tmpdir(), 'centrepass-prisma-rehearsal-'));
  try {
    const migrationRoot = path.join(rehearsalRoot, 'migrations');
    const baselineRoot = path.join(migrationRoot, HISTORICAL_BASELINE_MIGRATION);
    await mkdir(baselineRoot, { recursive: true });
    await writeFile(path.join(baselineRoot, 'migration.sql'), await readFile(
      path.resolve('prisma/baselines/pre-20260602/baseline.sql'),
    ));
    const retained = (await readdir(path.resolve('prisma/migrations'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
      .map((entry) => entry.name).toSorted();
    invariant(retained.length === 13, `expected 13 retained migrations, found ${retained.length}`);
    for (const migration of retained) {
      await cp(
        path.resolve('prisma/migrations', migration),
        path.join(migrationRoot, migration),
        { recursive: true },
      );
    }
    const schemaPath = path.join(rehearsalRoot, 'schema.prisma');
    await writeFile(schemaPath, await readFile(path.resolve('prisma/schema.prisma')));
    const configPath = path.join(rehearsalRoot, 'prisma.config.ts');
    await writeFile(configPath, [
      'import { defineConfig } from "prisma/config";',
      'export default defineConfig({',
      `  schema: ${JSON.stringify(schemaPath)},`,
      `  migrations: { path: ${JSON.stringify(migrationRoot)} },`,
      '  datasource: { url: process.env.DIRECT_URL! },',
      '});',
      '',
    ].join('\n'));
    const result = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--config', configPath], {
      env: process.env,
      encoding: 'utf8',
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    invariant(result.status === 0,
      `Prisma deploy failed with exit ${result.status}; P3005 or migration drift is not accepted`);
    console.log(JSON.stringify({
      status: 'rehearsed-historical-baseline-and-all-retained-migrations',
      historicalBaselineMigration: HISTORICAL_BASELINE_MIGRATION,
      retainedMigrationCount: retained.length,
    }));
  } finally {
    await rm(rehearsalRoot, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
