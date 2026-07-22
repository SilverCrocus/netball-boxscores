#!/usr/bin/env tsx

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  CATALOG_SQL,
  canonicalJson,
  catalogObjectChecksum,
  catalogSecurityStateChecksum,
  type AclEntry,
  type CatalogKind,
  type CatalogManifest,
  type CatalogObjectRecord,
  parseCatalogRecords,
  validateManifest,
  type SecurityState,
} from './verify-production-catalog';
import {
  readLocalMigrations,
  type MigrationDefinition,
} from './verify-production-migrations';
import { EXPECTED_PREVIEW_PRISMA_MIGRATIONS } from './lib/preview-prisma-ledger-contract';
import {
  verifyPreviewDatabaseTarget,
  type PreviewDatabaseTargetEvidence,
} from './lib/preview-database-target';

const CHECKED_IN_CATALOG_PATH = path.resolve('scripts/manifests/production-catalog.json');
const DEFAULT_OUTPUT_PATH = path.resolve('.artifacts/production-catalog.json');
const REQUIRED_FINAL_MIGRATION = '20260722010000_repair_analytics_cache_epoch_contract';

export interface PreviewCatalogLedgerRow {
  migrationName: string;
  checksum: string;
  finishedAt: unknown;
  rolledBackAt: unknown;
}

export interface VerifiedPreviewCatalogLedger {
  migrations: MigrationDefinition[];
  sourceMigrationThrough: string;
}

export interface CatalogGeneratorArguments {
  outputPath: string;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Preview production catalog generation failed: ${message}`);
}

export function parseCatalogGeneratorArguments(argv: string[]): CatalogGeneratorArguments {
  if (argv.length === 0) return { outputPath: DEFAULT_OUTPUT_PATH };
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) {
    throw new Error('Usage: npm run generate:production-catalog -- [--output <FILE>]');
  }
  const outputPath = path.resolve(argv[1]);
  invariant(outputPath !== CHECKED_IN_CATALOG_PATH,
    'the checked-in production catalog manifest is never a generator output target');
  return { outputPath };
}

export function assertPreviewCatalogGenerationEnvironment(
  environment: NodeJS.ProcessEnv,
  outputPath: string,
): PreviewDatabaseTargetEvidence {
  invariant(environment.PREVIEW_CATALOG_GENERATION === 'true',
    'PREVIEW_CATALOG_GENERATION=true is required');
  const resolvedOutputPath = path.resolve(outputPath);
  invariant(resolvedOutputPath !== CHECKED_IN_CATALOG_PATH,
    'the checked-in production catalog manifest is never a generator output target');
  return verifyPreviewDatabaseTarget(environment);
}

function sortedNames(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function validatePreviewCatalogLedger(
  rows: readonly PreviewCatalogLedgerRow[],
  localMigrations: readonly MigrationDefinition[],
): VerifiedPreviewCatalogLedger {
  invariant(localMigrations.length === 16,
    `expected the exact 16-migration checked-in chain, found ${localMigrations.length}`);
  const expectedNames = localMigrations.map((migration) => migration.name);
  invariant(JSON.stringify(expectedNames) === JSON.stringify(EXPECTED_PREVIEW_PRISMA_MIGRATIONS),
    'the checked-in migrations are not the exact contiguous preview chain');
  invariant(localMigrations.at(-1)?.name === REQUIRED_FINAL_MIGRATION,
    `expected ${REQUIRED_FINAL_MIGRATION} to be the final checked-in migration`);
  const actualNames = rows.map((migration) => migration.migrationName);
  invariant(rows.length === expectedNames.length,
    `expected ${expectedNames.length} final Prisma ledger rows, found ${rows.length}`);
  invariant(new Set(actualNames).size === actualNames.length,
    'the final Prisma ledger contains duplicate migration rows');
  invariant(JSON.stringify(actualNames) === JSON.stringify(expectedNames),
    'the final Prisma ledger is not the exact contiguous checked-in chain');

  for (const [index, expected] of localMigrations.entries()) {
    const actual = rows[index]!;
    invariant(actual.checksum === expected.checksum,
      `${expected.name} checksum does not match the checked-in SQL`);
    invariant(actual.finishedAt !== null, `${expected.name} is unfinished`);
    invariant(actual.rolledBackAt === null, `${expected.name} is rolled back`);
  }

  return {
    migrations: [...localMigrations],
    sourceMigrationThrough: localMigrations.at(-1)!.name,
  };
}

function aclEntries(state: SecurityState): AclEntry[] {
  invariant(Array.isArray(state.acl), 'catalog security state ACL is invalid');
  return state.acl as AclEntry[];
}

function profileFor(record: CatalogObjectRecord): string {
  if (record.kind === 'materialized_view') {
    throw new Error('Preview production catalog generation rejects materialized views in Phase 2');
  }
  if (record.kind === 'trigger') return 'trigger-owner';
  if (record.kind === 'function') {
    if (record.securityState.securityDefiner === false) return 'function-public-invoker';
    if (aclEntries(record.securityState).some((entry) => (
      entry.grantee === 'centrepass_stats_operations' && entry.privilege === 'EXECUTE'
    ))) return 'function-operations';
    return 'function-analytics-owner';
  }
  const reloptions = Array.isArray(record.securityState.reloptions)
    ? record.securityState.reloptions as string[]
    : [];
  if (reloptions.includes('security_barrier=true')) return 'view-owner-security-barrier';
  if (aclEntries(record.securityState).some((entry) => (
    entry.grantee === 'centrepass_analytics' && entry.privilege === 'SELECT'
  ))) return 'view-analytics-reader';
  return 'view-owner';
}

function objectKey(record: Pick<CatalogObjectRecord, 'kind' | 'identity'>): string {
  return `${record.kind}:${record.identity}`;
}

export function buildProductionCatalogManifest(input: {
  sourceProjectRef: string;
  sourceMigrationThrough: string;
  records: readonly CatalogObjectRecord[];
}): CatalogManifest {
  invariant(input.records.length > 0, 'the preview catalog query returned no application objects');
  const records = [...input.records].sort((left, right) => objectKey(left).localeCompare(objectKey(right)));
  const seen = new Set<string>();
  const profileStates = new Map<string, { kind: CatalogKind; state: SecurityState }>();
  const objects = records.map((record) => {
    const key = objectKey(record);
    invariant(!seen.has(key), `the preview catalog contains duplicate object ${key}`);
    seen.add(key);
    invariant(/^[a-f0-9]{64}$/.test(record.definitionSha256),
      `the preview catalog definition checksum is invalid for ${key}`);
    invariant(record.securityStateSha256 === catalogSecurityStateChecksum(record.securityState),
      `the preview catalog security checksum is invalid for ${key}`);
    invariant(record.sha256 === catalogObjectChecksum(record.definitionSha256, record.securityState),
      `the preview catalog object checksum is invalid for ${key}`);
    const securityProfile = profileFor(record);
    const currentProfile = profileStates.get(securityProfile);
    if (currentProfile) {
      invariant(canonicalJson(currentProfile.state) === canonicalJson(record.securityState),
        `security profile ${securityProfile} is not stable across preview objects`);
    } else {
      profileStates.set(securityProfile, { kind: record.kind, state: record.securityState });
    }
    return {
      kind: record.kind,
      identity: record.identity,
      definitionSha256: record.definitionSha256,
      securityProfile,
    };
  });

  const securityProfiles = Object.fromEntries(sortedNames([...profileStates.keys()]).map((name) => [
    name,
    profileStates.get(name)!,
  ]));
  const manifest: CatalogManifest = {
    schemaVersion: 2,
    hashAlgorithm: 'sha256',
    sourceProjectRef: input.sourceProjectRef,
    sourceMigrationThrough: input.sourceMigrationThrough,
    securityProfiles,
    objects,
  };
  validateManifest(manifest);
  return manifest;
}

async function readPreviewCatalogRecords(): Promise<CatalogObjectRecord[]> {
  const catalogSql = CATALOG_SQL.trim().replace(/;\s*$/, '');
  const rows = await prisma.$queryRawUnsafe<Array<{ catalogLine: string }>>(
    `SELECT catalog_line AS "catalogLine"
     FROM (${catalogSql}) AS catalog(catalog_line)`,
  );
  const records = rows.map((row) => {
    const parsed = parseCatalogRecords(row.catalogLine);
    invariant(parsed.length === 1, 'the preview catalog query returned an invalid object row');
    return parsed[0]!;
  });
  return records.toSorted((left, right) => objectKey(left).localeCompare(objectKey(right)));
}

async function readVerifiedPreviewLedger(): Promise<VerifiedPreviewCatalogLedger> {
  const localMigrations = await readLocalMigrations(path.resolve('prisma/migrations'));
  const rows = await prisma.$queryRaw<PreviewCatalogLedgerRow[]>(Prisma.sql`
    SELECT
      migration_name AS "migrationName",
      checksum,
      finished_at AS "finishedAt",
      rolled_back_at AS "rolledBackAt"
    FROM public."_prisma_migrations"
    ORDER BY migration_name`);
  return validatePreviewCatalogLedger(rows, localMigrations);
}

async function main(): Promise<void> {
  const { outputPath } = parseCatalogGeneratorArguments(process.argv.slice(2));
  const target = assertPreviewCatalogGenerationEnvironment(process.env, outputPath);
  const ledger = await readVerifiedPreviewLedger();
  const records = await readPreviewCatalogRecords();
  const manifest = buildProductionCatalogManifest({
    sourceProjectRef: target.expectedPreviewProjectRef,
    sourceMigrationThrough: ledger.sourceMigrationThrough,
    records,
  });
  const canonicalManifest = JSON.parse(canonicalJson(manifest)) as CatalogManifest;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(canonicalManifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    status: 'generated-preview-production-catalog-artifact',
    sourceProjectRef: target.expectedPreviewProjectRef,
    sourceMigrationThrough: ledger.sourceMigrationThrough,
    migrationCount: ledger.migrations.length,
    objectCount: manifest.objects.length,
    securityProfiles: Object.keys(manifest.securityProfiles),
  }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => { await prisma.$disconnect(); });
}
