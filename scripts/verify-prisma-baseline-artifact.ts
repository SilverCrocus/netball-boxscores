import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

interface Manifest {
  contract: string;
  sourceCommit: string;
  introducedMigrationCommit: string;
  sourcePath: string;
  sourceGitBlobSha1: string;
  schemaSha256: string;
  baselineSqlSha256: string;
  generatorNormalization: string;
  prismaVersion: string;
  firstRetainedMigration: string;
}

const root = path.resolve('prisma/baselines/pre-20260602');
const GENERATOR_NORMALIZATION = 'strip terminal ASCII whitespace and append LF';

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Prisma baseline artifact verification failed: ${message}`);
}

function digest(algorithm: 'sha1' | 'sha256', content: Buffer | string) {
  return createHash(algorithm).update(content).digest('hex');
}

function git(args: string[]) {
  const result = spawnSync('git', args, { encoding: 'buffer' });
  invariant(result.status === 0, `git ${args[0]} failed`);
  return result.stdout;
}

function normalizeGeneratedSql(content: string) {
  return `${content.replace(/[\t\n\r ]+$/u, '')}\n`;
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')) as Manifest;
  const schema = await readFile(path.join(root, 'schema.prisma'));
  const baselineSql = await readFile(path.join(root, 'baseline.sql'));
  invariant(manifest.generatorNormalization === GENERATOR_NORMALIZATION,
    'baseline SQL generator normalization contract differs');
  invariant(normalizeGeneratedSql(baselineSql.toString()) === baselineSql.toString(),
    'baseline SQL does not use one canonical terminal LF');
  invariant(digest('sha256', schema) === manifest.schemaSha256, 'frozen schema checksum differs');
  invariant(digest('sha256', baselineSql) === manifest.baselineSqlSha256,
    'baseline SQL checksum differs');
  const gitBlob = Buffer.concat([Buffer.from(`blob ${schema.length}\0`), schema]);
  invariant(digest('sha1', gitBlob) === manifest.sourceGitBlobSha1,
    'frozen schema Git blob identity differs');

  const sourceFromHistory = git(['show', `${manifest.sourceCommit}:${manifest.sourcePath}`]);
  invariant(sourceFromHistory.equals(schema), 'frozen schema differs from its repository-history source');
  invariant(git(['rev-parse', `${manifest.introducedMigrationCommit}^`]).toString().trim() ===
    manifest.sourceCommit, 'first retained migration commit is not a child of the baseline source commit');
  git(['cat-file', '-e',
    `${manifest.introducedMigrationCommit}:prisma/migrations/${manifest.firstRetainedMigration}/migration.sql`]);

  const generated = spawnSync('npx', [
    'prisma', 'migrate', 'diff', '--from-empty',
    '--to-schema-datamodel', path.join(root, 'schema.prisma'), '--script',
  ], { encoding: 'utf8', env: process.env });
  invariant(generated.status === 0, 'Prisma could not regenerate the baseline SQL');
  const sqlStart = generated.stdout.indexOf('-- CreateSchema');
  invariant(sqlStart >= 0, 'regenerated baseline SQL has no schema start');
  invariant(normalizeGeneratedSql(generated.stdout.slice(sqlStart)) === baselineSql.toString(),
    'baseline SQL is not reproducible from the frozen historical schema');

  const packageLock = JSON.parse(await readFile(path.resolve('package-lock.json'), 'utf8')) as {
    packages?: Record<string, { version?: string }>;
  };
  invariant(packageLock.packages?.['node_modules/prisma']?.version === manifest.prismaVersion,
    'locked Prisma version differs from the baseline generator version');
  console.log(JSON.stringify({
    status: 'verified-immutable-pre-20260602-baseline',
    contract: manifest.contract,
    sourceCommit: manifest.sourceCommit,
    sourceGitBlobSha1: manifest.sourceGitBlobSha1,
    schemaSha256: manifest.schemaSha256,
    baselineSqlSha256: manifest.baselineSqlSha256,
    generatorNormalization: manifest.generatorNormalization,
    firstRetainedMigration: manifest.firstRetainedMigration,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
