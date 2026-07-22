import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertPreviewCatalogGenerationEnvironment,
  buildProductionCatalogManifest,
  parseCatalogGeneratorArguments,
  validatePreviewCatalogLedger,
  type PreviewCatalogLedgerRow,
} from '../../../scripts/generate-production-catalog';
import {
  catalogDefinitionChecksum,
  catalogObjectChecksum,
  catalogSecurityStateChecksum,
  type CatalogKind,
  type CatalogObjectRecord,
  type SecurityState,
  validateManifest,
} from '../../../scripts/verify-production-catalog';
import { readLocalMigrations } from '../../../scripts/verify-production-migrations';

const PREVIEW_REF = 'xpfdjkqrbvdasjpllxnc';
const PRODUCTION_REF = 'iqnhnlttvnvkwrqvnrna';

function environment(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_ENVIRONMENT: 'staging',
    WORKER_ENABLED: 'false',
    ALLOW_SHARED_PRODUCTION_DB_WRITES: 'false',
    EXPECTED_PREVIEW_PROJECT_REF: PREVIEW_REF,
    PRODUCTION_PROJECT_REF: PRODUCTION_REF,
    DATABASE_URL: `postgresql://postgres.${PREVIEW_REF}:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`,
    DIRECT_URL: `postgresql://postgres:secret@db.${PREVIEW_REF}.supabase.co:5432/postgres`,
    PREVIEW_CATALOG_GENERATION: 'true',
    ...overrides,
  };
}

const ownerAcl = [
  { grantor: 'postgres', grantee: 'postgres', privilege: 'DELETE', grantable: false },
  { grantor: 'postgres', grantee: 'postgres', privilege: 'INSERT', grantable: false },
  { grantor: 'postgres', grantee: 'postgres', privilege: 'MAINTAIN', grantable: false },
  { grantor: 'postgres', grantee: 'postgres', privilege: 'REFERENCES', grantable: false },
  { grantor: 'postgres', grantee: 'postgres', privilege: 'SELECT', grantable: false },
  { grantor: 'postgres', grantee: 'postgres', privilege: 'TRIGGER', grantable: false },
  { grantor: 'postgres', grantee: 'postgres', privilege: 'TRUNCATE', grantable: false },
  { grantor: 'postgres', grantee: 'postgres', privilege: 'UPDATE', grantable: false },
];

const functionOwnerState: SecurityState = {
  acl: [{ grantor: 'postgres', grantee: 'postgres', privilege: 'EXECUTE', grantable: false }],
  config: ['search_path=""'],
  leakproof: false,
  owner: 'postgres',
  parallel: 'u',
  securityDefiner: true,
  strict: false,
  volatility: 'v',
};
const functionOperationsState: SecurityState = {
  ...functionOwnerState,
  acl: [
    { grantor: 'postgres', grantee: 'centrepass_stats_operations', privilege: 'EXECUTE', grantable: false },
    { grantor: 'postgres', grantee: 'postgres', privilege: 'EXECUTE', grantable: false },
  ],
};
const functionInvokerState: SecurityState = {
  ...functionOwnerState,
  config: ['search_path=public, pg_temp'],
  securityDefiner: false,
};
const triggerState: SecurityState = {
  acl: ownerAcl,
  enabled: 'O',
  owner: 'postgres',
};
const viewReaderState: SecurityState = {
  acl: [
    { grantor: 'postgres', grantee: 'centrepass_analytics', privilege: 'SELECT', grantable: false },
    ...ownerAcl,
  ],
  owner: 'postgres',
  reloptions: [],
};
const viewOwnerState: SecurityState = {
  acl: ownerAcl,
  owner: 'postgres',
  reloptions: [],
};
const viewBarrierState: SecurityState = {
  ...viewOwnerState,
  reloptions: ['security_barrier=true'],
};

function record(kind: CatalogKind, identity: string, state: SecurityState): CatalogObjectRecord {
  const definitionSha256 = catalogDefinitionChecksum(`SELECT '${identity}';`);
  return {
    kind,
    identity,
    definitionSha256,
    securityStateSha256: catalogSecurityStateChecksum(state),
    sha256: catalogObjectChecksum(definitionSha256, state),
    securityState: state,
  };
}

function sampleRecords(): CatalogObjectRecord[] {
  return [
    record('function', 'analytics.advance_cache_epoch()', functionOwnerState),
    record('function', 'analytics.write_stat_query_telemetry(text)', functionOperationsState),
    record('function', 'public.cp_validate_competition_topology()', functionInvokerState),
    record('trigger', 'public.Match.analytics_match_finalization_invalidation', triggerState),
    record('view', 'analytics.player_directory', viewReaderState),
    record('view', 'analytics.player_match_read', viewOwnerState),
    record('view', 'analytics.competition_directory', viewBarrierState),
  ];
}

describe('guarded preview production catalog generator', () => {
  it('requires the preview-only flag, exact target, and non-manifest output', () => {
    expect(() => assertPreviewCatalogGenerationEnvironment(
      environment({ PREVIEW_CATALOG_GENERATION: 'false' }),
      '.artifacts/production-catalog.json',
    )).toThrow('PREVIEW_CATALOG_GENERATION=true is required');
    expect(() => assertPreviewCatalogGenerationEnvironment(
      environment({ DATABASE_ENVIRONMENT: 'production' }),
      '.artifacts/production-catalog.json',
    )).toThrow('DATABASE_ENVIRONMENT=staging');
    expect(() => assertPreviewCatalogGenerationEnvironment(
      environment({ EXPECTED_PREVIEW_PROJECT_REF: 'aaaaaaaaaaaaaaaaaaaa' }),
      '.artifacts/production-catalog.json',
    )).toThrow('DATABASE_URL does not target the expected preview project');
    expect(() => parseCatalogGeneratorArguments([
      '--output', 'scripts/manifests/production-catalog.json',
    ])).toThrow('checked-in production catalog manifest');
    expect(parseCatalogGeneratorArguments([]).outputPath).toBe(
      path.resolve('.artifacts/production-catalog.json'),
    );
  });

  it('accepts only the exact final ledger and derives provenance from it', async () => {
    const migrations = await readLocalMigrations(path.resolve('prisma/migrations'));
    const rows: PreviewCatalogLedgerRow[] = migrations.map((migration) => ({
      migrationName: migration.name,
      checksum: migration.checksum,
      finishedAt: new Date(),
      rolledBackAt: null,
    }));
    expect(validatePreviewCatalogLedger(rows, migrations)).toEqual({
      migrations,
      sourceMigrationThrough: '20260722000000_add_analytics_cache_epoch',
    });
    expect(() => validatePreviewCatalogLedger(
      rows.map((row, index) => index === 1 ? { ...row, checksum: 'f'.repeat(64) } : row),
      migrations,
    )).toThrow('checksum does not match');
    expect(() => validatePreviewCatalogLedger(
      [...rows.slice(0, -1), rows[0]!],
      migrations,
    )).toThrow('duplicate migration rows');
  });

  it('builds a deterministic, validated manifest with derived profiles and counts', () => {
    const records = sampleRecords();
    const first = buildProductionCatalogManifest({
      sourceProjectRef: PREVIEW_REF,
      sourceMigrationThrough: '20260722000000_add_analytics_cache_epoch',
      records,
    });
    const second = buildProductionCatalogManifest({
      sourceProjectRef: PREVIEW_REF,
      sourceMigrationThrough: '20260722000000_add_analytics_cache_epoch',
      records: [...records].reverse(),
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.objects).toHaveLength(7);
    expect(Object.keys(first.securityProfiles)).toEqual([
      'function-analytics-owner',
      'function-operations',
      'function-public-invoker',
      'trigger-owner',
      'view-analytics-reader',
      'view-owner',
      'view-owner-security-barrier',
    ]);
    expect(validateManifest(first).checksums).toHaveLength(7);
  });

  it('fails closed for materialized views and unstable profiles', () => {
    expect(() => buildProductionCatalogManifest({
      sourceProjectRef: PREVIEW_REF,
      sourceMigrationThrough: '20260722000000_add_analytics_cache_epoch',
      records: [record('materialized_view', 'analytics.future', viewOwnerState)],
    })).toThrow('rejects materialized views');
    const records = sampleRecords();
    const changed = record('view', 'analytics.other', { ...viewOwnerState, reloptions: ['security_barrier=false'] });
    expect(() => buildProductionCatalogManifest({
      sourceProjectRef: PREVIEW_REF,
      sourceMigrationThrough: '20260722000000_add_analytics_cache_epoch',
      records: [...records, changed],
    })).toThrow('security profile view-owner is not stable');
  });
});
