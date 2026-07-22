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
const CHECKOUT_PIN = 'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0';
const SETUP_NODE_PIN = 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020';

function expectMarkersInOrder(source: string, markers: string[]): void {
  let previousIndex = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    expect(index, `missing workflow marker: ${marker}`).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}

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
    const verify = workflow.slice(
      workflow.indexOf('  verify:'),
      workflow.indexOf('  glasgow-preview-rehearsal:'),
    );
    const postgres17 = workflow.slice(
      workflow.indexOf('  postgres17-analytics-rehearsal:'),
      workflow.indexOf('  glasgow-preview-rehearsal:'),
    );
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
    expect(workflow.split(`uses: ${CHECKOUT_PIN}`)).toHaveLength(4);
    expect(workflow.split(`uses: ${SETUP_NODE_PIN}`)).toHaveLength(4);
    expect(workflow).not.toMatch(/actions\/(?:checkout|setup-node)@v\d+/);
    for (const job of [verify, postgres17, rehearsal]) {
      expect(job).toContain('persist-credentials: false');
      expect(job).toContain('fetch-depth: 0');
    }
    expectMarkersInOrder(verify, [
      'run: npm ci',
      'run: npx prisma generate',
      'run: npm audit --omit=dev --audit-level=moderate',
      'run: npm run check',
      'run: npm run build',
      'run: npm run smoke:server-startup',
    ]);
    expect(postgres17).toContain('image: postgres:17');
    expect(postgres17).not.toContain('needs:');
    expect(postgres17).toContain(
      'DATABASE_URL: postgresql://postgres@127.0.0.1:5432/postgres?schema=public',
    );
    expect(postgres17).toContain(
      'DIRECT_URL: postgresql://postgres@127.0.0.1:5432/postgres?schema=public',
    );
    expect(postgres17).toContain('FRESH_MIGRATION_REHEARSAL: "true"');
    expect(postgres17).not.toContain('SUPABASE_PREVIEW_DATABASE_URL');
    expectMarkersInOrder(postgres17, [
      'run: npm ci',
      'run: npx prisma generate',
      'run: npx tsx scripts/verify-fresh-prisma-migration-target.ts',
      'run: npx tsx scripts/verify-prisma-baseline-artifact.ts',
      'run: npx tsx scripts/rehearse-complete-prisma-migrations.ts',
      'run: npx tsx scripts/verify-preview-migrations.ts',
      'run: npx tsx scripts/rehearse-analytics-cache-epoch.ts',
    ]);
    expect(rehearsal).toContain('name: centrepass-preview-rehearsal');
    expect(rehearsal).toContain('image: postgres:17');
    expectMarkersInOrder(rehearsal, [
      'name: Install dependencies',
      'name: Capture refs-only preview target evidence',
      'name: Prove empty PostgreSQL 17 target and seed minimal Supabase roles',
      'name: Verify immutable historical Prisma baseline',
      'name: Rehearse historical baseline and complete retained migration chain',
      'name: Verify complete fresh PostgreSQL 17 migration ledger',
      'name: Verify and resolve Supabase remote-schema Prisma prefix',
      'name: Deploy checked-in Prisma migrations',
      'name: Verify exact checked-in migration ledger',
      'name: Provision reviewed scoped preview roles without emitting credentials',
      'name: Verify exact scoped preview role allowlists',
      'name: Verify zero current and default Data API grants',
      'name: Generate guarded preview production catalog artifact',
      'name: Upload guarded preview production catalog artifact',
      'name: Validate the immutable bundle offline',
      'name: Normalize preview publication state to DRAFT',
      'name: Prepare unpublished foundation',
      'name: Build database-aware import plan',
      'name: Record clean preview receipt',
      'name: Prove controlled import failure rolls back canonical writes',
      'name: Apply exact bundle to preview',
      'name: Prove exact replay is idempotent',
      'name: Reconcile exact DRAFT preview state',
      'name: Exercise publication readiness without publishing',
    ]);
    expect(rehearsal).not.toContain('prisma db execute');
    expect(rehearsal).toContain('PREVIEW_CATALOG_GENERATION: "true"');
    expect(rehearsal).toContain(
      'npm run generate:production-catalog -- --output .artifacts/production-catalog.json',
    );
    expect(rehearsal).toContain(
      'uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    );
    expect(rehearsal).toContain('path: .artifacts/production-catalog.json');
    expect(rehearsal).not.toContain('scripts/manifests/production-catalog.json');
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
    expect(rehearsal).not.toMatch(/db:publish:edition[^\n]*--apply/);
  });
});
