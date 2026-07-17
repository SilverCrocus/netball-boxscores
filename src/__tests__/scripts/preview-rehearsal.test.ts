import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  projectRefFromPreviewDatabaseUrl,
  verifyPreviewDatabaseTarget,
} from '../../../scripts/lib/preview-database-target';
import { matchesPlainBtreeIndex } from '../../../scripts/lib/preview-index-contract';

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
    ...overrides,
  };
}

describe('preview rehearsal target guard', () => {
  it('extracts project refs from direct and pooler URLs without returning credentials', () => {
    expect(projectRefFromPreviewDatabaseUrl(
      'DATABASE_URL',
      environment().DATABASE_URL!,
    )).toBe(PREVIEW_REF);
    expect(projectRefFromPreviewDatabaseUrl(
      'DIRECT_URL',
      environment().DIRECT_URL!,
    )).toBe(PREVIEW_REF);
    expect(verifyPreviewDatabaseTarget(environment())).toEqual({
      expectedPreviewProjectRef: PREVIEW_REF,
      productionProjectRef: PRODUCTION_REF,
      databaseUrlProjectRef: PREVIEW_REF,
      directUrlProjectRef: PREVIEW_REF,
    });
  });

  it('rejects production and mismatched targets before any database command', () => {
    expect(() => verifyPreviewDatabaseTarget(environment({
      DATABASE_URL: `postgresql://postgres.${PRODUCTION_REF}:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`,
    }))).toThrow('DATABASE_URL targets the forbidden production project');
    expect(() => verifyPreviewDatabaseTarget(environment({
      DIRECT_URL: 'postgresql://postgres:secret@db.aaaaaaaaaaaaaaaaaaaa.supabase.co:5432/postgres',
    }))).toThrow('DIRECT_URL does not target the expected preview project');
    expect(() => verifyPreviewDatabaseTarget(environment({
      DIRECT_URL: `postgresql://postgres.${PREVIEW_REF}:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`,
    }))).toThrow('DIRECT_URL must use a direct or session-mode endpoint on port 5432');
  });
});

describe('Glasgow preview workflow', () => {
  it('compares mixed-case quoted index identifiers by catalog semantics', () => {
    const expectation = {
      name: 'Match_competitionId_status_scheduledAt_idx',
      tableName: 'Match',
      columns: ['competitionId', 'status', 'scheduledAt'],
    };
    const actual = {
      ...expectation,
      unique: false,
      valid: true,
      ready: true,
      live: true,
      exclusion: false,
      clustered: false,
      nullsNotDistinct: false,
      method: 'btree',
      predicate: null,
      hasExpressions: false,
      hasIncludedColumns: false,
      hasNondefaultSortOptions: false,
      hasNondefaultOperatorClasses: false,
      hasNondefaultCollations: false,
    };
    expect(matchesPlainBtreeIndex(actual, expectation)).toBe(true);
    expect(matchesPlainBtreeIndex(
      { ...actual, columns: ['competitionid', 'status', 'scheduledat'] },
      expectation,
    )).toBe(false);
  });

  it('installs dependencies, deploys and verifies migrations, proves rollback, and never publishes', async () => {
    const workflow = await readFile(path.resolve('.github/workflows/ci.yml'), 'utf8');
    const rehearsal = workflow.slice(workflow.indexOf('  glasgow-preview-rehearsal:'));
    const migrationRehearsal = await readFile(
      path.resolve('scripts/rehearse-complete-prisma-migrations.ts'),
      'utf8',
    );
    const maintainMigration = await readFile(
      path.resolve(
        'prisma/migrations/20260717010000_close_postgres17_maintain_acl/migration.sql',
      ),
      'utf8',
    );
    const baselineSql = await readFile(
      path.resolve('prisma/baselines/pre-20260602/baseline.sql'),
      'utf8',
    );
    const baselineManifest = JSON.parse(await readFile(
      path.resolve('prisma/baselines/pre-20260602/manifest.json'),
      'utf8',
    )) as { generatorNormalization?: string };

    expect(workflow).toContain(
      "format('preview-rehearsal-{0}', inputs.expected_preview_project_ref)",
    );
    expect(workflow).toContain(
      "${{ !(github.event_name == 'workflow_dispatch' && inputs.run_glasgow_preview) }}",
    );
    expect(rehearsal).toContain('npm ci');
    expect(rehearsal).toContain('name: centrepass-preview-rehearsal');
    expect(rehearsal).toContain('npx tsx scripts/verify-preview-database-target.ts');
    expect(rehearsal).toContain('image: postgres:17');
    expect(rehearsal).toContain('npx tsx scripts/verify-fresh-prisma-migration-target.ts');
    expect(rehearsal).toContain('npx tsx scripts/verify-prisma-baseline-artifact.ts');
    expect(rehearsal).toContain('npx tsx scripts/rehearse-complete-prisma-migrations.ts');
    expect(rehearsal).not.toContain('prisma db execute');
    expect(migrationRehearsal).toContain('prisma/baselines/pre-20260602/baseline.sql');
    expect(migrationRehearsal).toContain('00000000000000_historical_baseline');
    expect(migrationRehearsal).toContain('P3005 or migration drift is not accepted');
    expect(migrationRehearsal).toContain("mkdtemp(path.resolve('.prisma-rehearsal-'))");
    expect(migrationRehearsal).not.toContain("from 'node:os'");
    expect(baselineSql).toMatch(/[^\s]\n$/);
    expect(baselineSql).not.toMatch(/\n\n$/);
    expect(baselineManifest.generatorNormalization).toBe(
      'strip terminal ASCII whitespace and append LF',
    );
    expect(maintainMigration).toContain("server_version_num')::integer >= 170000");
    expect(maintainMigration).toContain('REVOKE MAINTAIN ON ALL TABLES');
    expect(maintainMigration).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres');
    expect(maintainMigration).not.toContain('supabase_admin');
    expect(rehearsal).toContain('npx tsx scripts/verify-preview-prisma-baseline.ts --resolve');
    expect(rehearsal).toContain('npx prisma migrate deploy');
    expect(rehearsal).toContain('npx tsx scripts/verify-preview-migrations.ts');
    expect(rehearsal).toContain('npx tsx scripts/provision-preview-scoped-roles.ts');
    expect(rehearsal).toContain('npx tsx scripts/verify-preview-scoped-roles.ts');
    expect(rehearsal).toContain('npx tsx scripts/verify-preview-data-api-acls.ts');
    expect(rehearsal.indexOf('scripts/provision-preview-scoped-roles.ts')).toBeLessThan(
      rehearsal.indexOf('scripts/verify-preview-scoped-roles.ts'),
    );
    expect(rehearsal.indexOf('scripts/verify-preview-scoped-roles.ts')).toBeLessThan(
      rehearsal.indexOf('scripts/verify-preview-data-api-acls.ts'),
    );
    expect(rehearsal).toContain('npx tsx scripts/rehearse-glasgow-2026-rollback.ts');
    expect(rehearsal).toContain('db:publish:edition -- commonwealth-games-netball glasgow-2026 --dry-run');
    expect(rehearsal).not.toMatch(/db:publish:edition[^\n]*--apply/);
  });
});
