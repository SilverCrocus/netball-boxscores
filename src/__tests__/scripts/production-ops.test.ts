import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateProtectedLibpqEnvironment } from '../../../scripts/lib/production-psql';
import {
  projectRefFromDatabaseUrl,
  validateProductionDatabaseUrl,
  verifyProductionTargets,
} from '../../../scripts/production-target-guard';
import {
  compareMigrationState,
  parseProductionMigrationLedger,
} from '../../../scripts/verify-production-migrations';
import {
  catalogDefinitionChecksum,
  catalogObjectChecksum,
  catalogSecurityStateChecksum,
  compareCatalog,
  parseCatalogOutput,
  validateManifest,
  type SecurityState,
} from '../../../scripts/verify-production-catalog';

const PRODUCTION_REF = 'iqnhnlttvnvkwrqvnrna';
const PREVIEW_REF = 'xpfdjkqrbvdasjpllxnc';
const CHECKSUM_A = 'a'.repeat(64);
const CHECKSUM_B = 'b'.repeat(64);
const POOLER = 'aws-0-ap-southeast-2.pooler.supabase.com';
const TLS = '?sslmode=verify-full';

describe('production operation guards', () => {
  it('requires both owner URLs to resolve to the same production project', () => {
    const result = verifyProductionTargets({
      NODE_ENV: 'test',
      EXPECTED_PRODUCTION_PROJECT_REF: PRODUCTION_REF,
      REJECTED_PREVIEW_PROJECT_REF: PREVIEW_REF,
      DATABASE_URL: `postgresql://postgres.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres${TLS}`,
      DIRECT_URL: `postgresql://postgres:secret@db.${PRODUCTION_REF}.supabase.co:5432/postgres${TLS}`,
    });
    expect(result.targets).toEqual({
      DATABASE_URL: PRODUCTION_REF,
      DIRECT_URL: PRODUCTION_REF,
    });

    expect(() => projectRefFromDatabaseUrl(
      'DIRECT_URL',
      `postgresql://postgres:secret@db.${PREVIEW_REF}.supabase.co:5432/postgres${TLS}`,
      PRODUCTION_REF,
      PREVIEW_REF,
    )).toThrow('rejected preview project');

    expect(() => projectRefFromDatabaseUrl(
      'DATABASE_URL',
      `postgresql://postgres.${PRODUCTION_REF}:secret@database.example.com:6543/postgres${TLS}`,
      PRODUCTION_REF,
      PREVIEW_REF,
    )).toThrow('not an approved Supabase database or pooler endpoint');
  });

  it('requires scoped URLs to use authentic Supabase routing for the same project', () => {
    const result = verifyProductionTargets({
      NODE_ENV: 'test',
      EXPECTED_PRODUCTION_PROJECT_REF: PRODUCTION_REF,
      REJECTED_PREVIEW_PROJECT_REF: PREVIEW_REF,
      DATABASE_URL: `postgresql://postgres.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres${TLS}`,
      DIRECT_URL: `postgresql://postgres:secret@db.${PRODUCTION_REF}.supabase.co:5432/postgres${TLS}`,
      ANALYTICS_DATABASE_URL: `postgresql://centrepass_analytics.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres${TLS}`,
      STATS_OPERATIONS_DATABASE_URL: `postgresql://centrepass_stats_operations.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres${TLS}`,
    }, true);

    expect(Object.values(result.targets)).toEqual([
      PRODUCTION_REF,
      PRODUCTION_REF,
      PRODUCTION_REF,
      PRODUCTION_REF,
    ]);
  });

  it('enforces variable-specific Supabase endpoint, role, port, database, and TLS rules', () => {
    const validate = (variable: Parameters<typeof validateProductionDatabaseUrl>[0], url: string) => (
      validateProductionDatabaseUrl(variable, url, PRODUCTION_REF, PREVIEW_REF)
    );
    expect(validate(
      'DIRECT_URL',
      `postgresql://postgres%2E${PRODUCTION_REF}:secret@${POOLER}:5432/postgres${TLS}`,
    )).toMatchObject({ mode: 'session', role: 'postgres', port: 5432 });
    expect(() => validate(
      'DIRECT_URL',
      `postgresql://postgres.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres${TLS}`,
    )).toThrow('direct/session port 5432');
    expect(() => validate(
      'ANALYTICS_DATABASE_URL',
      `postgresql://centrepass_analytics:secret@db.${PRODUCTION_REF}.supabase.co:5432/postgres${TLS}`,
    )).toThrow('shared transaction pooler');
    expect(() => validate(
      'ANALYTICS_DATABASE_URL',
      `postgresql://centrepass_analytics.${PRODUCTION_REF}:secret@${POOLER}:5432/postgres${TLS}`,
    )).toThrow('shared transaction pooler');
    expect(() => validate(
      'DATABASE_URL',
      `postgresql://postgres.${PRODUCTION_REF}:secret@${POOLER}:6543/app${TLS}`,
    )).toThrow('postgres database');
    expect(() => validate(
      'DATABASE_URL',
      `postgresql://postgres.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres?sslmode=disable`,
    )).toThrow('sslmode=verify-full');
    expect(() => validate(
      'DATABASE_URL',
      `postgresql://postgres.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres?sslmode=verify-full&sslmode=verify-full`,
    )).toThrow('duplicate connection parameter');
    expect(() => validate(
      'DATABASE_URL',
      `postgresql://postgres.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres`,
    )).toThrow('sslmode=verify-full');
    expect(() => validate(
      'DATABASE_URL',
      `postgresql://postgres.${PRODUCTION_REF}:secret@aws-0-ap-southeast-2.pooler.supabase.com.evil.test:6543/postgres${TLS}`,
    )).toThrow('not an approved Supabase');
    expect(() => validate(
      'DATABASE_URL',
      `postgresql://postgres.${PRODUCTION_REF}:secret@extra.aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres${TLS}`,
    )).toThrow('not an approved Supabase');
    expect(() => validate(
      'DATABASE_URL',
      `postgresql://postgres.${PRODUCTION_REF}:secret@aws-ap-southeast-2.pooler.supabase.com:6543/postgres${TLS}`,
    )).toThrow('not an approved Supabase');
    expect(() => validate(
      'DATABASE_URL',
      `postgresql://postgres%252E${PRODUCTION_REF}:secret@${POOLER}:6543/postgres${TLS}`,
    )).toThrow('double-encoded username');
    expect(() => validate(
      'DATABASE_URL',
      `postgresql://postgres.${PREVIEW_REF}:secret@${POOLER}:6543/postgres${TLS}`,
    )).toThrow('rejected preview');
    expect(() => validate(
      'STATS_OPERATIONS_DATABASE_URL',
      `postgresql://centrepass_analytics.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres${TLS}`,
    )).toThrow('least-privilege role');
  });

  it('parses and binds the protected libpq service and password entry', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'centrepass-libpq-'));
    const serviceFile = path.join(directory, 'service.conf');
    const passwordFile = path.join(directory, 'pgpass');
    try {
      await writeFile(serviceFile, [
        '[centrepass-production-direct]',
        `host=db.${PRODUCTION_REF}.supabase.co`,
        'port=5432',
        'dbname=postgres',
        'user=postgres',
        'sslmode=verify-full',
        '',
      ].join('\n'), { mode: 0o600 });
      await writeFile(passwordFile, `db.${PRODUCTION_REF}.supabase.co:5432:postgres:postgres:password\n`, { mode: 0o600 });
      const baseEnvironment = {
        NODE_ENV: 'test' as const,
        EXPECTED_PRODUCTION_PROJECT_REF: PRODUCTION_REF,
        REJECTED_PREVIEW_PROJECT_REF: PREVIEW_REF,
        PGSERVICE: 'centrepass-production-direct',
        PGSERVICEFILE: serviceFile,
        PGPASSFILE: passwordFile,
      };
      expect(validateProtectedLibpqEnvironment({
        ...baseEnvironment,
      })).toMatchObject({ service: 'centrepass-production-direct', target: PRODUCTION_REF, mode: 'direct' });
      expect(() => validateProtectedLibpqEnvironment({
        ...baseEnvironment,
        PGHOST: 'override.example',
      })).toThrow('PGHOST must be unset');
      expect(() => validateProtectedLibpqEnvironment({
        ...baseEnvironment,
        PGSSLMODE: 'disable',
      })).toThrow('PGSSLMODE must be unset');
      expect(() => validateProtectedLibpqEnvironment({
        ...baseEnvironment,
        PGSERVICE: 'centrepass-production-other',
      })).toThrow('PGSERVICE must be centrepass-production-direct');

      await writeFile(serviceFile, `${await readFile(serviceFile, 'utf8')}include=/tmp/override\n`, { mode: 0o600 });
      expect(() => validateProtectedLibpqEnvironment(baseEnvironment)).toThrow('must not include');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects duplicate, weak, mismatched, and permissive libpq configuration', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'centrepass-libpq-reject-'));
    const serviceFile = path.join(directory, 'service.conf');
    const passwordFile = path.join(directory, 'pgpass');
    const environment = {
      NODE_ENV: 'test' as const,
      EXPECTED_PRODUCTION_PROJECT_REF: PRODUCTION_REF,
      REJECTED_PREVIEW_PROJECT_REF: PREVIEW_REF,
      PGSERVICE: 'centrepass-production-direct',
      PGSERVICEFILE: serviceFile,
      PGPASSFILE: passwordFile,
    };
    const service = (overrides: string[] = []) => [
      '[centrepass-production-direct]',
      `host=db.${PRODUCTION_REF}.supabase.co`,
      'port=5432',
      'dbname=postgres',
      'user=postgres',
      'sslmode=verify-full',
      ...overrides,
      '',
    ].join('\n');
    try {
      await writeFile(passwordFile, `db.${PRODUCTION_REF}.supabase.co:5432:postgres:postgres:password\n`, { mode: 0o600 });
      await writeFile(serviceFile, service(['sslmode=disable']), { mode: 0o600 });
      expect(() => validateProtectedLibpqEnvironment(environment)).toThrow('duplicate key sslmode');
      await writeFile(serviceFile, service().replace('verify-full', 'require'), { mode: 0o600 });
      expect(() => validateProtectedLibpqEnvironment(environment)).toThrow('sslmode=verify-full');
      await writeFile(serviceFile, `${service()}[centrepass-production-direct]\nhost=evil\n`, { mode: 0o600 });
      expect(() => validateProtectedLibpqEnvironment(environment)).toThrow('duplicate section');
      await writeFile(serviceFile, service().replace(PRODUCTION_REF, PREVIEW_REF), { mode: 0o600 });
      expect(() => validateProtectedLibpqEnvironment(environment)).toThrow('rejected preview');
      await writeFile(serviceFile, service().replace(`db.${PRODUCTION_REF}.supabase.co`, 'db.forged.supabase.co'), { mode: 0o600 });
      expect(() => validateProtectedLibpqEnvironment(environment)).toThrow('not an approved Supabase');
      await writeFile(serviceFile, service().replace('dbname=postgres', 'dbname=app'), { mode: 0o600 });
      expect(() => validateProtectedLibpqEnvironment(environment)).toThrow('postgres database');
      await writeFile(serviceFile, service().replace('user=postgres', 'user=centrepass_analytics'), { mode: 0o600 });
      expect(() => validateProtectedLibpqEnvironment(environment)).toThrow('postgres role');
      await writeFile(serviceFile, service().replace('port=5432', 'port=6543'), { mode: 0o600 });
      expect(() => validateProtectedLibpqEnvironment(environment)).toThrow('direct/session port 5432');
      await writeFile(serviceFile, service()
        .replace(`host=db.${PRODUCTION_REF}.supabase.co`, `host=${POOLER}`)
        .replace('user=postgres', `user=postgres.${PRODUCTION_REF}`), { mode: 0o600 });
      await writeFile(passwordFile, `${POOLER}:5432:postgres:postgres.${PRODUCTION_REF}:password\n`, { mode: 0o600 });
      expect(validateProtectedLibpqEnvironment(environment)).toMatchObject({ mode: 'session', target: PRODUCTION_REF });
      await writeFile(serviceFile, service(), { mode: 0o600 });
      await writeFile(passwordFile, `db.${PRODUCTION_REF}.supabase.co:5432:wrong:postgres:password\n`, { mode: 0o600 });
      expect(() => validateProtectedLibpqEnvironment(environment)).toThrow('does not match');
      await writeFile(passwordFile, `db.${PRODUCTION_REF}.supabase.co:5432:postgres:postgres:password\n`, { mode: 0o644 });
      await chmod(passwordFile, 0o644);
      expect(() => validateProtectedLibpqEnvironment(environment)).toThrow('group/other');
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

  it('fails catalog verification for missing, unexpected, or changed security-critical state', () => {
    const definition = 'SELECT 1;';
    const definitionSha256 = catalogDefinitionChecksum(definition);
    const state: SecurityState = { acl: [], owner: 'postgres', reloptions: ['security_barrier=true'] };
    const expected = [{
      kind: 'view' as const,
      identity: 'analytics.example',
      definitionSha256,
      securityStateSha256: catalogSecurityStateChecksum(state),
      sha256: catalogObjectChecksum(definitionSha256, state),
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
      {
        kind: 'function',
        identity: 'analytics.extra()',
        definitionSha256: CHECKSUM_A,
        securityStateSha256: CHECKSUM_A,
        sha256: CHECKSUM_B,
      },
    ])).toMatchObject({
      passed: false,
      unexpected: ['function:analytics.extra()'],
    });

    const row = [
      'view',
      Buffer.from('analytics.example').toString('base64'),
      Buffer.from(definition).toString('base64'),
      Buffer.from(JSON.stringify(state)).toString('base64'),
    ].join('\t');
    expect(parseCatalogOutput(`${row}\n`)).toEqual(expected);
  });

  it('hashes every reviewed view, function, trigger, owner, and ACL field', () => {
    const view: SecurityState = { acl: [], owner: 'postgres', reloptions: [] };
    const fn: SecurityState = {
      acl: [],
      config: ['search_path=""'],
      leakproof: false,
      owner: 'postgres',
      parallel: 'u',
      securityDefiner: true,
      strict: false,
      volatility: 'v',
    };
    const trigger: SecurityState = { acl: [], enabled: 'O', owner: 'postgres' };
    const variants: Array<[SecurityState, SecurityState]> = [
      [view, { ...view, owner: 'other' }],
      [view, { ...view, acl: [{ grantor: 'postgres', grantee: 'reader', privilege: 'SELECT', grantable: false }] }],
      [view, { ...view, reloptions: ['security_invoker=true'] }],
      [view, { ...view, reloptions: ['security_barrier=true'] }],
      [fn, { ...fn, owner: 'other' }],
      [fn, { ...fn, acl: [{ grantor: 'postgres', grantee: 'PUBLIC', privilege: 'EXECUTE', grantable: false }] }],
      [fn, { ...fn, config: [] }],
      [fn, { ...fn, leakproof: true }],
      [fn, { ...fn, parallel: 's' }],
      [fn, { ...fn, securityDefiner: false }],
      [fn, { ...fn, strict: true }],
      [fn, { ...fn, volatility: 's' }],
      [trigger, { ...trigger, owner: 'other' }],
      [trigger, { ...trigger, acl: [{ grantor: 'postgres', grantee: 'reader', privilege: 'SELECT', grantable: false }] }],
      [trigger, { ...trigger, enabled: 'D' }],
    ];
    for (const [before, after] of variants) {
      expect(catalogObjectChecksum(CHECKSUM_A, after)).not.toBe(catalogObjectChecksum(CHECKSUM_A, before));
    }
  });

  it('fails closed for incomplete, duplicate, or out-of-order catalog manifests', () => {
    const base = {
      schemaVersion: 2,
      hashAlgorithm: 'sha256',
      sourceProjectRef: PRODUCTION_REF,
      sourceMigrationThrough: '20260717000000_secure_analytics_query_boundary',
      securityProfiles: {
        view: { kind: 'view', state: { acl: [], owner: 'postgres', reloptions: [] } },
      },
      objects: [{
        kind: 'view',
        identity: 'analytics.a',
        definitionSha256: CHECKSUM_A,
        securityProfile: 'view',
      }],
    } as const;
    expect(validateManifest(base).checksums).toHaveLength(1);
    expect(() => validateManifest({ ...base, objects: [...base.objects, ...base.objects] }))
      .toThrow('unique and canonically ordered');
    expect(() => validateManifest({
      ...base,
      objects: [
        { ...base.objects[0], identity: 'analytics.b' },
        base.objects[0],
      ],
    })).toThrow('unique and canonically ordered');
    expect(() => validateManifest({
      ...base,
      securityProfiles: {
        view: { kind: 'view', state: { acl: [], owner: 'postgres' } },
      },
    })).toThrow('missing or unreviewed fields');
    expect(() => validateManifest({ ...base, unexpected: true })).toThrow('missing or unreviewed fields');
    expect(() => validateManifest({
      ...base,
      securityProfiles: {
        unused: { kind: 'view', state: { acl: [], owner: 'postgres', reloptions: [] } },
        ...base.securityProfiles,
      },
    })).toThrow('unused security profiles');
  });
});
