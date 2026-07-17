import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateProtectedLibpqEnvironment } from '../../../scripts/lib/production-psql';
import {
  projectRefFromDatabaseUrl,
  verifyProductionTargets,
} from '../../../scripts/production-target-guard';
import {
  compareMigrationState,
  parseProductionMigrationLedger,
} from '../../../scripts/verify-production-migrations';
import {
  catalogDefinitionChecksum,
  compareCatalog,
  parseCatalogOutput,
} from '../../../scripts/verify-production-catalog';

const PRODUCTION_REF = 'iqnhnlttvnvkwrqvnrna';
const PREVIEW_REF = 'xpfdjkqrbvdasjpllxnc';
const CHECKSUM_A = 'a'.repeat(64);
const CHECKSUM_B = 'b'.repeat(64);

describe('production operation guards', () => {
  it('requires both owner URLs to resolve to the same production project', () => {
    const result = verifyProductionTargets({
      NODE_ENV: 'test',
      EXPECTED_PRODUCTION_PROJECT_REF: PRODUCTION_REF,
      REJECTED_PREVIEW_PROJECT_REF: PREVIEW_REF,
      DATABASE_URL: `postgresql://postgres.${PRODUCTION_REF}:secret@aws-0.example.pooler.supabase.com:6543/postgres`,
      DIRECT_URL: `postgresql://postgres:secret@db.${PRODUCTION_REF}.supabase.co:5432/postgres`,
    });
    expect(result.targets).toEqual({
      DATABASE_URL: PRODUCTION_REF,
      DIRECT_URL: PRODUCTION_REF,
    });

    expect(() => projectRefFromDatabaseUrl(
      'DIRECT_URL',
      `postgresql://postgres:secret@db.${PREVIEW_REF}.supabase.co:5432/postgres`,
      PRODUCTION_REF,
      PREVIEW_REF,
    )).toThrow('rejected preview project');

    expect(() => projectRefFromDatabaseUrl(
      'DATABASE_URL',
      `postgresql://postgres.${PRODUCTION_REF}:secret@database.example.com:6543/postgres`,
      PRODUCTION_REF,
      PREVIEW_REF,
    )).toThrow('not an approved Supabase database or pooler endpoint');
  });

  it('requires scoped URLs to use authentic Supabase routing for the same project', () => {
    const result = verifyProductionTargets({
      NODE_ENV: 'test',
      EXPECTED_PRODUCTION_PROJECT_REF: PRODUCTION_REF,
      REJECTED_PREVIEW_PROJECT_REF: PREVIEW_REF,
      DATABASE_URL: `postgresql://postgres.${PRODUCTION_REF}:secret@aws-0.example.pooler.supabase.com:6543/postgres`,
      DIRECT_URL: `postgresql://postgres:secret@db.${PRODUCTION_REF}.supabase.co:5432/postgres`,
      ANALYTICS_DATABASE_URL: `postgresql://centrepass_analytics.${PRODUCTION_REF}:secret@aws-0.example.pooler.supabase.com:6543/postgres`,
      STATS_OPERATIONS_DATABASE_URL: `postgresql://centrepass_stats_operations.${PRODUCTION_REF}:secret@aws-0.example.pooler.supabase.com:6543/postgres`,
    }, true);

    expect(Object.values(result.targets)).toEqual([
      PRODUCTION_REF,
      PRODUCTION_REF,
      PRODUCTION_REF,
      PRODUCTION_REF,
    ]);
  });

  it('rejects libpq override variables and permissive credential files', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'centrepass-libpq-'));
    const serviceFile = path.join(directory, 'service.conf');
    const passwordFile = path.join(directory, 'pgpass');
    try {
      await writeFile(serviceFile, '[centrepass-production-direct]\nhost=example\n', { mode: 0o600 });
      await writeFile(passwordFile, 'example:5432:postgres:user:password\n', { mode: 0o600 });
      expect(validateProtectedLibpqEnvironment({
        NODE_ENV: 'test',
        PGSERVICE: 'centrepass-production-direct',
        PGSERVICEFILE: serviceFile,
        PGPASSFILE: passwordFile,
      })).toMatchObject({ service: 'centrepass-production-direct' });
      expect(() => validateProtectedLibpqEnvironment({
        NODE_ENV: 'test',
        PGSERVICE: 'centrepass-production-direct',
        PGSERVICEFILE: serviceFile,
        PGPASSFILE: passwordFile,
        PGHOST: 'override.example',
      })).toThrow('PGHOST must be unset');
      expect(() => validateProtectedLibpqEnvironment({
        NODE_ENV: 'test',
        PGSERVICE: 'centrepass-production-direct',
        PGSERVICEFILE: serviceFile,
        PGPASSFILE: passwordFile,
        PGSSLMODE: 'disable',
      })).toThrow('PGSSLMODE must be unset');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('allows only the explicitly reviewed local pending migration set before deploy', () => {
    const local = [
      { name: '001_first', checksum: CHECKSUM_A },
      { name: '002_pending', checksum: CHECKSUM_B },
    ];
    const production = [{ name: '001_first', checksum: CHECKSUM_A, status: 'applied' as const }];
    expect(compareMigrationState('predeploy', local, production, ['002_pending'])).toMatchObject({
      passed: true,
      pendingLocal: ['002_pending'],
    });
    expect(compareMigrationState('predeploy', local, production, [])).toMatchObject({
      passed: false,
      unexpectedPending: ['002_pending'],
    });
    expect(compareMigrationState('postdeploy', local, [
      production[0],
      { name: '002_pending', checksum: CHECKSUM_B, status: 'applied' as const },
    ], [])).toMatchObject({ passed: true, pendingLocal: [] });
    expect(compareMigrationState('predeploy', local, [
      { name: '001_first', checksum: CHECKSUM_B, status: 'applied' as const },
    ], ['002_pending'])).toMatchObject({ passed: false, changedProduction: ['001_first'] });
  });

  it('parses the immutable production ledger contract', () => {
    const encodedName = Buffer.from('001_first').toString('base64');
    expect(parseProductionMigrationLedger(`${encodedName}\t${CHECKSUM_A}\tapplied\n`)).toEqual([{
      name: '001_first',
      checksum: CHECKSUM_A,
      status: 'applied',
    }]);
  });

  it('fails catalog verification for missing, unexpected, or changed definitions', () => {
    const definition = 'SELECT 1;';
    const expected = [{
      kind: 'view' as const,
      identity: 'analytics.example',
      sha256: catalogDefinitionChecksum(definition),
    }];
    expect(compareCatalog(expected, expected)).toMatchObject({ passed: true });
    expect(compareCatalog(expected, [])).toMatchObject({
      passed: false,
      missing: ['view:analytics.example'],
    });
    expect(compareCatalog(expected, [{ ...expected[0], sha256: CHECKSUM_A }])).toMatchObject({
      passed: false,
      changed: ['view:analytics.example'],
    });
    expect(compareCatalog(expected, [
      expected[0],
      { kind: 'function', identity: 'analytics.extra()', sha256: CHECKSUM_B },
    ])).toMatchObject({
      passed: false,
      unexpected: ['function:analytics.extra()'],
    });

    const row = [
      'view',
      Buffer.from('analytics.example').toString('base64'),
      Buffer.from(definition).toString('base64'),
    ].join('\t');
    expect(parseCatalogOutput(`${row}\n`)).toEqual(expected);
  });
});
