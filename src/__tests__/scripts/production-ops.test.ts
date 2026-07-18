import { access, chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { validateProtectedLibpqEnvironment } from '../../../scripts/lib/production-psql';
import {
  assertGlasgowDatabaseActionAllowed,
  GLASGOW_GUARD_ENVIRONMENT,
  GLASGOW_PRODUCTION_GUARD,
  type GlasgowDatabaseAction,
} from '../../../scripts/lib/glasgow-production-guard';
import {
  executeGuardedGlasgowAction,
  parseGuardedGlasgowArguments,
} from '../../../scripts/production-glasgow';
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
const OTHER_REF = 'abcdefghijklmnopqrst';
const CHECKSUM_A = 'a'.repeat(64);
const CHECKSUM_B = 'b'.repeat(64);
const POOLER = 'aws-0-ap-southeast-2.pooler.supabase.com';
const DIRECT_PARAMETERS = '?sslmode=verify-full';
const TRANSACTION_PARAMETERS = '?sslmode=verify-full&pgbouncer=true';
const ANALYTICS_PARAMETERS = `${TRANSACTION_PARAMETERS}&connection_limit=5&pool_timeout=5`;
const OPERATIONS_PARAMETERS = `${TRANSACTION_PARAMETERS}&connection_limit=2&pool_timeout=5`;

function validProductionEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_ENVIRONMENT: 'production',
    EXPECTED_PRODUCTION_PROJECT_REF: PRODUCTION_REF,
    REJECTED_PREVIEW_PROJECT_REF: PREVIEW_REF,
    DATABASE_URL: `postgresql://postgres.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres${TRANSACTION_PARAMETERS}`,
    DIRECT_URL: `postgresql://postgres:secret@db.${PRODUCTION_REF}.supabase.co:5432/postgres${DIRECT_PARAMETERS}`,
  };
}

function fencedBashLogicalCommands(markdown: string): string[] {
  const commands: string[] = [];
  const blocks = [...markdown.matchAll(/```bash\r?\n([\s\S]*?)```/g)]
    .map((match) => match[1] ?? '');
  for (const block of blocks) {
    let command = '';
    for (const rawLine of block.split(/\r?\n/)) {
      const continued = /\\\s*$/.test(rawLine);
      const segment = rawLine.replace(/\\\s*$/, '').trim();
      if (!segment || segment.startsWith('#')) continue;
      command = command ? `${command} ${segment}` : segment;
      if (!continued) {
        commands.push(command);
        command = '';
      }
    }
    if (command) throw new Error('fenced Bash block has an unterminated line continuation');
  }
  return commands;
}

function shellTokens(command: string): string[] {
  return (command.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g) ?? [])
    .map((token) => {
      const first = token.at(0);
      return first && first === token.at(-1) && ['"', "'"].includes(first)
        ? token.slice(1, -1)
        : token;
    });
}

function scriptInvocationIndex(tokens: string[], script: string): number {
  return tokens.findIndex((token, index) => (
    token === 'npm' && tokens[index + 1] === 'run' && tokens[index + 2] === script
  ));
}

function assertGuardedRunbookPublicationCommands(markdown: string, label: string): void {
  for (const command of fencedBashLogicalCommands(markdown)) {
    const tokens = shellTokens(command);
    if (scriptInvocationIndex(tokens, 'db:publish:edition') >= 0) {
      throw new Error(`${label} contains a direct publication command`);
    }
    const wrapperIndex = scriptInvocationIndex(tokens, 'production:glasgow');
    const publishIndex = tokens.indexOf('publish', wrapperIndex + 3);
    if (wrapperIndex < 0 || publishIndex < 0) continue;

    const evidenceIndexes = tokens
      .map((token, index) => token === '--evidence-file' ? index : -1)
      .filter((index) => index >= 0);
    if (evidenceIndexes.length !== 1) {
      throw new Error(`${label} publication must contain exactly one --evidence-file option`);
    }
    const evidenceIndex = evidenceIndexes[0]!;
    const evidencePath = tokens[evidenceIndex + 1];
    if (!evidencePath || evidencePath.startsWith('--') || evidencePath === 'publish') {
      throw new Error(`${label} publication --evidence-file must have a following path argument`);
    }
    if (evidenceIndex > publishIndex) {
      throw new Error(`${label} publication --evidence-file must precede the publish action`);
    }
  }
}

function assertNoDirectGlasgowDatabaseCommands(markdown: string, label: string): void {
  for (const command of fencedBashLogicalCommands(markdown)) {
    const tokens = shellTokens(command);
    for (const script of [
      'db:prepare:glasgow',
      'db:import:glasgow:results',
      'db:publish:edition',
      'db:unpublish:edition',
    ]) {
      if (scriptInvocationIndex(tokens, script) >= 0) {
        throw new Error(`${label} contains direct production-capable command ${script}`);
      }
    }

    const foundationImport = scriptInvocationIndex(tokens, 'db:import:glasgow');
    if (foundationImport >= 0 && !tokens.includes('--offline-preview')) {
      throw new Error(`${label} contains a direct database-aware Glasgow foundation import`);
    }
  }
}

describe('production operation guards', () => {
  it('requires both owner URLs to resolve to the same production project', () => {
    const result = verifyProductionTargets({
      NODE_ENV: 'test',
      EXPECTED_PRODUCTION_PROJECT_REF: PRODUCTION_REF,
      REJECTED_PREVIEW_PROJECT_REF: PREVIEW_REF,
      DATABASE_URL: `postgresql://postgres.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres${TRANSACTION_PARAMETERS}`,
      DIRECT_URL: `postgresql://postgres:secret@db.${PRODUCTION_REF}.supabase.co:5432/postgres${DIRECT_PARAMETERS}`,
    });
    expect(result.targets).toEqual({
      DATABASE_URL: PRODUCTION_REF,
      DIRECT_URL: PRODUCTION_REF,
    });

    expect(() => projectRefFromDatabaseUrl(
      'DIRECT_URL',
      `postgresql://postgres:secret@db.${PREVIEW_REF}.supabase.co:5432/postgres${DIRECT_PARAMETERS}`,
      PRODUCTION_REF,
      PREVIEW_REF,
    )).toThrow('rejected preview project');

    expect(() => projectRefFromDatabaseUrl(
      'DATABASE_URL',
      `postgresql://postgres.${PRODUCTION_REF}:secret@database.example.com:6543/postgres${TRANSACTION_PARAMETERS}`,
      PRODUCTION_REF,
      PREVIEW_REF,
    )).toThrow('not an approved Supabase database or pooler endpoint');
  });

  it('requires scoped URLs to use authentic Supabase routing for the same project', () => {
    const result = verifyProductionTargets({
      NODE_ENV: 'test',
      EXPECTED_PRODUCTION_PROJECT_REF: PRODUCTION_REF,
      REJECTED_PREVIEW_PROJECT_REF: PREVIEW_REF,
      DATABASE_URL: `postgresql://postgres.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres${TRANSACTION_PARAMETERS}`,
      DIRECT_URL: `postgresql://postgres:secret@db.${PRODUCTION_REF}.supabase.co:5432/postgres${DIRECT_PARAMETERS}`,
      ANALYTICS_DATABASE_URL: `postgresql://centrepass_analytics.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres${ANALYTICS_PARAMETERS}`,
      STATS_OPERATIONS_DATABASE_URL: `postgresql://centrepass_stats_operations.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres${OPERATIONS_PARAMETERS}`,
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
      `postgresql://postgres%2E${PRODUCTION_REF}:secret@${POOLER}:5432/postgres${DIRECT_PARAMETERS}`,
    )).toMatchObject({ mode: 'session', role: 'postgres', port: 5432 });
    expect(() => validate(
      'DIRECT_URL',
      `postgresql://postgres.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres${TRANSACTION_PARAMETERS}`,
    )).toThrow('direct/session port 5432');
    expect(() => validate(
      'ANALYTICS_DATABASE_URL',
      `postgresql://centrepass_analytics:secret@db.${PRODUCTION_REF}.supabase.co:5432/postgres${DIRECT_PARAMETERS}`,
    )).toThrow('shared transaction pooler');
    expect(() => validate(
      'ANALYTICS_DATABASE_URL',
      `postgresql://centrepass_analytics.${PRODUCTION_REF}:secret@${POOLER}:5432/postgres${DIRECT_PARAMETERS}`,
    )).toThrow('shared transaction pooler');
    expect(() => validate(
      'DATABASE_URL',
      `postgresql://postgres.${PRODUCTION_REF}:secret@${POOLER}:6543/app${TRANSACTION_PARAMETERS}`,
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
      `postgresql://postgres.${PRODUCTION_REF}:secret@aws-0-ap-southeast-2.pooler.supabase.com.evil.test:6543/postgres${TRANSACTION_PARAMETERS}`,
    )).toThrow('not an approved Supabase');
    expect(() => validate(
      'DATABASE_URL',
      `postgresql://postgres.${PRODUCTION_REF}:secret@extra.aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres${TRANSACTION_PARAMETERS}`,
    )).toThrow('not an approved Supabase');
    expect(() => validate(
      'DATABASE_URL',
      `postgresql://postgres.${PRODUCTION_REF}:secret@aws-ap-southeast-2.pooler.supabase.com:6543/postgres${TRANSACTION_PARAMETERS}`,
    )).toThrow('not an approved Supabase');
    expect(() => validate(
      'DATABASE_URL',
      `postgresql://postgres%252E${PRODUCTION_REF}:secret@${POOLER}:6543/postgres${TRANSACTION_PARAMETERS}`,
    )).toThrow('double-encoded username');
    expect(() => validate(
      'DATABASE_URL',
      `postgresql://postgres.${PREVIEW_REF}:secret@${POOLER}:6543/postgres${TRANSACTION_PARAMETERS}`,
    )).toThrow('rejected preview');
    expect(() => validate(
      'STATS_OPERATIONS_DATABASE_URL',
      `postgresql://centrepass_analytics.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres${OPERATIONS_PARAMETERS}`,
    )).toThrow('least-privilege role');
  });

  it('enforces exact variable-specific connection parameter values', () => {
    const validate = (variable: Parameters<typeof validateProductionDatabaseUrl>[0], query: string) => (
      validateProductionDatabaseUrl(
        variable,
        variable === 'DIRECT_URL'
          ? `postgresql://postgres:secret@db.${PRODUCTION_REF}.supabase.co:5432/postgres?${query}`
          : `postgresql://${variable === 'ANALYTICS_DATABASE_URL' ? 'centrepass_analytics' : variable === 'STATS_OPERATIONS_DATABASE_URL' ? 'centrepass_stats_operations' : 'postgres'}.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres?${query}`,
        PRODUCTION_REF,
        PREVIEW_REF,
      )
    );

    expect(validate('DATABASE_URL', 'sslmode=verify-full&pgbouncer=true&connect_timeout=30&connection_limit=20&pool_timeout=30'))
      .toMatchObject({ mode: 'transaction' });
    expect(() => validate('DIRECT_URL', 'sslmode=verify-full&channel_binding=disable'))
      .toThrow('unreviewed connection parameter');
    expect(() => validate('DIRECT_URL', 'sslmode=verify-full&application_name=unreviewed'))
      .toThrow('unreviewed connection parameter');
    expect(() => validate('DIRECT_URL', 'sslmode=verify-full&sslrootcert=/tmp/unreviewed.pem'))
      .toThrow('unreviewed connection parameter');
    expect(() => validate('DIRECT_URL', 'sslmode=verify-full&pgbouncer=true'))
      .toThrow('unreviewed connection parameter');
    expect(() => validate('DATABASE_URL', 'sslmode=verify-full&pgbouncer=false'))
      .toThrow('pgbouncer=true');
    expect(() => validate('DATABASE_URL', 'sslmode=verify-full&pgbouncer=%66alse'))
      .toThrow('pgbouncer=true');
    expect(() => validate('DATABASE_URL', 'sslmode=verify-full&pgbouncer=true&%70gbouncer=true'))
      .toThrow('duplicate connection parameter');
    expect(() => validate('DATABASE_URL', 'sslmode=verify-full&pgbouncer=true&connect_timeout=0'))
      .toThrow('positive integer');
    expect(() => validate('DATABASE_URL', 'sslmode=verify-full&pgbouncer=true&connect_timeout=abc'))
      .toThrow('positive integer');
    expect(() => validate('DATABASE_URL', 'sslmode=verify-full&pgbouncer=true&connect_timeout=31'))
      .toThrow('at most 30');
    expect(() => validate('DATABASE_URL', 'sslmode=verify-full&pgbouncer=true&connection_limit=21'))
      .toThrow('at most 20');
    expect(() => validate('DATABASE_URL', 'sslmode=verify-full&pgbouncer=true&connection_limit=0'))
      .toThrow('positive integer');
    expect(() => validate('DATABASE_URL', 'sslmode=verify-full&pgbouncer=true&pool_timeout=abc'))
      .toThrow('positive integer');
    expect(() => validate('DATABASE_URL', 'sslmode=verify-full&pgbouncer=true&pool_timeout=999999'))
      .toThrow('at most 30');
    expect(() => validate('DATABASE_URL', 'sslmode=verify-full&pgbouncer=true&pool_timeout=5&pool_timeout=5'))
      .toThrow('duplicate connection parameter');
    expect(() => validate('ANALYTICS_DATABASE_URL', 'sslmode=verify-full&pgbouncer=true&connection_limit=4&pool_timeout=5'))
      .toThrow('connection_limit=5');
    expect(() => validate('STATS_OPERATIONS_DATABASE_URL', 'sslmode=verify-full&pgbouncer=true&connection_limit=2&pool_timeout=6'))
      .toThrow('connection_limit=2 and pool_timeout=5');
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

  it('maps only reviewed database-aware Glasgow production actions', () => {
    const evidence = '/private/evidence/target.json';
    expect(parseGuardedGlasgowArguments([
      '--evidence-file', evidence, 'prepare',
    ])).toMatchObject({ action: 'prepare', script: 'prepare-glasgow-2026.ts', arguments: [] });
    expect(parseGuardedGlasgowArguments([
      '--evidence-file', evidence, 'foundation', 'data/glasgow-2026/v1/bundle.json', '--record-preview',
    ])).toMatchObject({ action: 'foundation-record-preview', arguments: ['data/glasgow-2026/v1/bundle.json', '--record-preview'] });
    expect(parseGuardedGlasgowArguments([
      '--evidence-file', evidence, 'results', '/private/results.json', '--apply', '--confirm', 'token',
    ])).toMatchObject({ action: 'results-apply', arguments: ['/private/results.json', '--apply', '--confirm', 'token'] });
    expect(parseGuardedGlasgowArguments([
      '--evidence-file', evidence, 'publish', '--dry-run',
    ])).toMatchObject({
      action: 'publish-dry-run',
      arguments: ['commonwealth-games-netball', 'glasgow-2026', '--dry-run'],
    });
    expect(parseGuardedGlasgowArguments([
      '--evidence-file', evidence, 'unpublish', '--confirm-unpublish',
    ])).toMatchObject({
      action: 'unpublish-apply',
      script: 'unpublish-edition.ts',
      arguments: ['commonwealth-games-netball', 'glasgow-2026', '--confirm-unpublish'],
    });
    expect(() => parseGuardedGlasgowArguments([
      '--evidence-file', evidence, 'foundation', 'other.json', '--apply',
    ])).toThrow('Usage:');
    expect(() => parseGuardedGlasgowArguments([
      '--evidence-file', evidence, 'results', 'relative.json',
    ])).toThrow('Usage:');
  });

  it('requires every production runbook publication command to use the guarded wrapper', async () => {
    const runbooksDirectory = path.resolve('docs/runbooks');
    const runbooks = (await readdir(runbooksDirectory))
      .filter((file) => file.endsWith('.md'))
      .sort((left, right) => left.localeCompare(right));
    const rollback = await readFile(path.join(runbooksDirectory, 'glasgow-2026-rollback.md'), 'utf8');

    expect(rollback).not.toMatch(/^\s*npm run db:publish:edition\b/m);
    expect(rollback).not.toMatch(/^\s*npm run db:unpublish:edition\b/m);
    expect(rollback.match(/npm run production:glasgow --/g)).toHaveLength(3);
    expect(rollback.match(/--evidence-file /g)).toHaveLength(3);
    expect(rollback).toContain('chmod 700 "$RELEASE_EVIDENCE_DIR/glasgow/targets"');
    expect(rollback).toContain('emergency-unpublish.json');
    expect(rollback).toContain('rollback-publication-dry-run.json');
    expect(rollback).toContain('rollback-publication-apply.json');

    for (const runbook of runbooks) {
      const body = await readFile(path.join(runbooksDirectory, runbook), 'utf8');
      expect(() => assertGuardedRunbookPublicationCommands(body, runbook)).not.toThrow();
      expect(() => assertNoDirectGlasgowDatabaseCommands(body, runbook)).not.toThrow();
    }
  });

  it.each<GlasgowDatabaseAction>([
    'prepare',
    'foundation-preview',
    'foundation-record-preview',
    'foundation-apply',
    'results-preview',
    'results-record-preview',
    'results-apply',
    'publish-dry-run',
    'publish-apply',
    'unpublish-apply',
  ])('rejects a direct production bypass for %s', async (action) => {
    await expect(assertGlasgowDatabaseActionAllowed(action, validProductionEnvironment()))
      .rejects.toThrow('must run through npm run production:glasgow');
  });

  it.each([
    ['prepare', 'prepare-glasgow-2026.ts', []],
    ['foundation import', 'import-glasgow-2026.ts', ['data/glasgow-2026/v1/bundle.json', '--apply']],
    ['results import', 'import-glasgow-2026-results.ts', ['/private/missing-results.json', '--record-preview']],
    ['publication', 'publish-edition.ts', ['commonwealth-games-netball', 'glasgow-2026', '--dry-run']],
    ['emergency unpublish', 'unpublish-edition.ts', ['commonwealth-games-netball', 'glasgow-2026', '--confirm-unpublish']],
  ])('blocks the direct %s script before any production database access', (_label, script, args) => {
    const environment = {
      ...process.env,
      ...validProductionEnvironment(),
    };
    for (const name of Object.values(GLASGOW_GUARD_ENVIRONMENT)) delete environment[name];

    const result = spawnSync(process.execPath, [
      '--import',
      'tsx',
      path.resolve('scripts', script),
      ...args,
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: environment,
      shell: false,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Glasgow production database actions must run through npm run production:glasgow',
    );
    expect(result.stderr).not.toContain('P1001');
  });

  it('preserves explicit preview and development database workflows', async () => {
    await expect(assertGlasgowDatabaseActionAllowed('foundation-apply', {
      NODE_ENV: 'test',
      DATABASE_ENVIRONMENT: 'staging',
      DATABASE_URL: `postgresql://postgres.${PREVIEW_REF}:secret@${POOLER}:6543/postgres`,
      DIRECT_URL: `postgresql://postgres:secret@db.${PREVIEW_REF}.supabase.co:5432/postgres`,
    })).resolves.toBe('non-production');

    await expect(assertGlasgowDatabaseActionAllowed('prepare', {
      NODE_ENV: 'development',
      DATABASE_ENVIRONMENT: 'local',
      DATABASE_URL: 'postgresql://postgres:secret@127.0.0.1:5432/centrepass',
    })).resolves.toBe('non-production');
  });

  it('detects a production Supabase route even when the environment is mislabeled', async () => {
    await expect(assertGlasgowDatabaseActionAllowed('prepare', {
      NODE_ENV: 'test',
      DATABASE_ENVIRONMENT: 'staging',
      DATABASE_URL: `postgresql://postgres.${PRODUCTION_REF}:secret@${POOLER}:6543/postgres`,
    })).rejects.toThrow('must run through npm run production:glasgow');
  });

  it('rejects a forged wrapper marker without its private evidence capability', async () => {
    await expect(assertGlasgowDatabaseActionAllowed('prepare', {
      ...validProductionEnvironment(),
      [GLASGOW_GUARD_ENVIRONMENT.guard]: GLASGOW_PRODUCTION_GUARD,
      [GLASGOW_GUARD_ENVIRONMENT.action]: 'prepare',
    })).rejects.toThrow('CENTREPASS_GLASGOW_PRODUCTION_EVIDENCE_FILE');
  });

  it('rejects evidence flags attached to the wrong logical publication command', () => {
    const malformed = [
      '```bash',
      'npm run production:glasgow -- \\',
      '  --evidence-file "/private/dry-run.json" \\',
      '  --evidence-file "/private/apply.json" \\',
      '  publish --dry-run',
      'npm run production:glasgow -- \\',
      '  publish --apply --confirm <TOKEN>',
      '```',
    ].join('\n');
    const publishCommands = fencedBashLogicalCommands(malformed);

    expect(publishCommands).toHaveLength(2);
    expect(publishCommands.map((command) => (
      shellTokens(command).filter((token) => token === '--evidence-file').length
    ))).toEqual([2, 0]);
    expect(() => assertGuardedRunbookPublicationCommands(malformed, 'malformed.md'))
      .toThrow('exactly one --evidence-file');
  });

  it('rejects a publication evidence option without a following path value', () => {
    const malformed = [
      '```bash',
      'npm run production:glasgow -- \\',
      '  --evidence-file \\',
      '  publish --dry-run',
      '```',
    ].join('\n');

    expect(() => assertGuardedRunbookPublicationCommands(malformed, 'missing-value.md'))
      .toThrow('must have a following path argument');
  });

  it('writes refs-only private evidence before executing an approved Glasgow action', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'centrepass-glasgow-guard-'));
    const evidenceFile = path.join(directory, 'foundation-preview.json');
    const spawn = vi.fn((
      _command: string,
      _argumentsList: string[],
      _options: { env: NodeJS.ProcessEnv; shell: false; stdio: 'inherit' },
    ) => {
      void _command;
      void _argumentsList;
      void _options;
      return { status: 0 };
    });
    try {
      const action = parseGuardedGlasgowArguments([
        '--evidence-file', evidenceFile,
        'foundation', 'data/glasgow-2026/v1/bundle.json',
      ]);
      await executeGuardedGlasgowAction(action, validProductionEnvironment(), { spawn });

      expect(spawn).toHaveBeenCalledOnce();
      const [command, argumentsList, options] = spawn.mock.calls[0]!;
      expect(command).toBe(process.execPath);
      expect(argumentsList.some((value) => value.endsWith(path.join('scripts', 'import-glasgow-2026.ts')))).toBe(true);
      expect(JSON.stringify(argumentsList)).not.toContain('postgresql://');
      expect(options).toMatchObject({ shell: false, stdio: 'inherit' });
      expect((await stat(evidenceFile)).mode & 0o777).toBe(0o600);
      const evidence = await readFile(evidenceFile, 'utf8');
      expect(JSON.parse(evidence)).toMatchObject({
        action: 'foundation-preview',
        expectedProjectRef: PRODUCTION_REF,
        targets: { DATABASE_URL: PRODUCTION_REF, DIRECT_URL: PRODUCTION_REF },
      });
      expect(evidence).not.toContain('secret');
      expect(evidence).not.toContain(POOLER);

      const guardedEnvironment = options.env;
      expect(evidence).not.toContain(
        guardedEnvironment[GLASGOW_GUARD_ENVIRONMENT.nonce],
      );
      await expect(assertGlasgowDatabaseActionAllowed(
        'foundation-preview',
        guardedEnvironment,
        { parentPid: () => process.pid },
      )).resolves.toBe('guarded-production');
      await expect(assertGlasgowDatabaseActionAllowed(
        'prepare',
        guardedEnvironment,
        { parentPid: () => process.pid },
      )).rejects.toThrow('action does not match');
      await expect(assertGlasgowDatabaseActionAllowed(
        'foundation-preview',
        guardedEnvironment,
        { parentPid: () => process.pid + 1 },
      )).rejects.toThrow('not started by the guarded wrapper');
      await expect(assertGlasgowDatabaseActionAllowed(
        'foundation-preview',
        {
          ...guardedEnvironment,
          [GLASGOW_GUARD_ENVIRONMENT.nonce]: 'f'.repeat(64),
        },
        { parentPid: () => process.pid },
      )).rejects.toThrow('nonce does not match');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['guard rejection', {
      DATABASE_URL: `postgresql://postgres.${PRODUCTION_REF}:secret@forged.pooler.supabase.com:6543/postgres${TRANSACTION_PARAMETERS}`,
    }],
    ['divergent targets', {
      DIRECT_URL: `postgresql://postgres:secret@db.${OTHER_REF}.supabase.co:5432/postgres${DIRECT_PARAMETERS}`,
    }],
  ])('never executes a Glasgow action after %s', async (_label, override) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'centrepass-glasgow-reject-'));
    const evidenceFile = path.join(directory, 'rejected.json');
    const spawn = vi.fn((
      _command: string,
      _argumentsList: string[],
      _options: { env: NodeJS.ProcessEnv; shell: false; stdio: 'inherit' },
    ) => {
      void _command;
      void _argumentsList;
      void _options;
      return { status: 0 };
    });
    try {
      const action = parseGuardedGlasgowArguments([
        '--evidence-file', evidenceFile, 'publish', '--dry-run',
      ]);
      await expect(executeGuardedGlasgowAction(action, {
        ...validProductionEnvironment(),
        ...override,
      }, { spawn })).rejects.toThrow();
      expect(spawn).not.toHaveBeenCalled();
      await expect(access(evidenceFile)).rejects.toMatchObject({ code: 'ENOENT' });
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
