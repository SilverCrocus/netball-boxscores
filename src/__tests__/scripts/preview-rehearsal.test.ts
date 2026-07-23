import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  projectRefFromPreviewDatabaseUrl,
  verifyPreviewDatabaseTarget,
} from '../../../scripts/lib/preview-database-target';
import { matchesPlainBtreeIndex } from '../../../scripts/lib/preview-index-contract';
import {
  assertGlasgowPreviewFresh,
  dirtyGlasgowPreviewCategories,
  readGlasgowPreviewFreshness,
  runGlasgowPreviewFreshnessPreflight,
  type GlasgowPreviewFreshnessCounts,
} from '../../../scripts/verify-glasgow-2026-preview-freshness';

const PREVIEW_REF = 'xpfdjkqrbvdasjpllxnc';
const PRODUCTION_REF = 'iqnhnlttvnvkwrqvnrna';
const CHECKOUT_PIN = 'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0';
const SETUP_NODE_PIN = 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020';

function emptyFreshnessCounts(): GlasgowPreviewFreshnessCounts {
  return {
    importRuns: 0,
    sourceSnapshots: 0,
    sourceMappings: 0,
    sourceSystem: 0,
    foundationSeries: 0,
    foundationRuleset: 0,
    foundationCompetition: 0,
    foundationEditionSources: 0,
    foundationStages: 0,
    foundationStageGroups: 0,
    canonicalTeams: 0,
    canonicalPlayers: 0,
    canonicalEntries: 0,
    canonicalRosters: 0,
    canonicalMatches: 0,
    canonicalMatchSlots: 0,
    canonicalMatchQuarters: 0,
    canonicalCoverage: 0,
    canonicalImportMutations: 0,
    canonicalImportIssues: 0,
  };
}

function countOnly(
  overrides: Partial<GlasgowPreviewFreshnessCounts>,
): GlasgowPreviewFreshnessCounts {
  return { ...emptyFreshnessCounts(), ...overrides };
}

function countClient(counts: GlasgowPreviewFreshnessCounts) {
  const delegates = [
    ['importRun', counts.importRuns],
    ['sourceSnapshot', counts.sourceSnapshots],
    ['sourceEntityMapping', counts.sourceMappings],
    ['sourceSystem', counts.sourceSystem],
    ['competitionSeries', counts.foundationSeries],
    ['ruleset', counts.foundationRuleset],
    ['competition', counts.foundationCompetition],
    ['editionSource', counts.foundationEditionSources],
    ['stage', counts.foundationStages],
    ['stageGroup', counts.foundationStageGroups],
    ['team', counts.canonicalTeams],
    ['player', counts.canonicalPlayers],
    ['editionEntry', counts.canonicalEntries],
    ['rosterMembership', counts.canonicalRosters],
    ['match', counts.canonicalMatches],
    ['matchSlot', counts.canonicalMatchSlots],
    ['matchQuarter', counts.canonicalMatchQuarters],
    ['dataCoverage', counts.canonicalCoverage],
    ['importMutation', counts.canonicalImportMutations],
    ['importIssue', counts.canonicalImportIssues],
  ] as const;
  const calls: Array<{ model: string; args: unknown }> = [];
  const client = Object.fromEntries(delegates.map(([model, count]) => [model, {
    count: vi.fn(async (args: unknown) => {
      calls.push({ model, args });
      return count;
    }),
  }])) as unknown as PrismaClient;
  return { client, calls };
}

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

describe('Glasgow preview freshness preflight', () => {
  it('accepts an empty target and performs only count reads', async () => {
    const { client, calls } = countClient(emptyFreshnessCounts());
    const result = await runGlasgowPreviewFreshnessPreflight(client, environment());
    expect(result.counts).toEqual(emptyFreshnessCounts());
    expect(calls).toHaveLength(20);
    expect(calls.every(({ model }) => model !== 'prisma')).toBe(true);
  });

  it.each([
    ['dry-run-only receipt', { importRuns: 1 }],
    ['failed receipt', { importRuns: 1 }],
    ['authoritative apply receipt', { importRuns: 1 }],
    ['replay receipt', { importRuns: 1 }],
    ['source snapshot', { sourceSnapshots: 1 }],
    ['source mapping', { sourceMappings: 1 }],
    ['canonical imported state', { canonicalMatches: 1 }],
  ])('rejects %s with the exact reset instruction', async (_label, overrides) => {
    const { client } = countClient(countOnly(overrides));
    await expect(runGlasgowPreviewFreshnessPreflight(client, environment()))
      .rejects.toThrow(/29a1a5f9-8e67-46b0-8efe-89f32feb1ad4.*20260715122711_remote_schema/);
  });

  it('rejects every canonical state category, not only matches', () => {
    const canonicalFields: Array<keyof GlasgowPreviewFreshnessCounts> = [
      'canonicalTeams', 'canonicalPlayers', 'canonicalEntries', 'canonicalRosters',
      'canonicalMatches', 'canonicalMatchSlots', 'canonicalMatchQuarters',
      'canonicalCoverage', 'canonicalImportMutations', 'canonicalImportIssues',
    ];
    for (const field of canonicalFields) {
      expect(dirtyGlasgowPreviewCategories(countOnly({ [field]: 1 })))
        .toContain('canonical-state');
    }
    expect(() => assertGlasgowPreviewFresh(countOnly({ importRuns: 1 })))
      .toThrow('read-only preflight did not delete or repair');
  });

  it('does not filter receipts by status or dry-run mode', async () => {
    const { client, calls } = countClient(emptyFreshnessCounts());
    await readGlasgowPreviewFreshness(client);
    const importRunWhere = calls.find(({ model }) => model === 'importRun')?.args as {
      where?: Record<string, unknown>;
    };
    expect(importRunWhere.where).not.toHaveProperty('status');
    expect(importRunWhere.where).not.toHaveProperty('dryRun');
  });

  it('rejects mismatched and production-equivalent refs before querying the database', async () => {
    const { client, calls } = countClient(emptyFreshnessCounts());
    await expect(runGlasgowPreviewFreshnessPreflight(client, environment({
      DATABASE_URL: `postgresql://postgres.${PRODUCTION_REF}:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`,
    }))).rejects.toThrow('DATABASE_URL targets the forbidden production project');
    expect(calls).toHaveLength(0);
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
      'run: npm run verify:standings-postgres',
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
      'name: Verify Glasgow preview freshness before database writes',
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

  it('keeps the read-only freshness preflight before every Glasgow data write or receipt', async () => {
    const workflow = await readFile(path.resolve('.github/workflows/ci.yml'), 'utf8');
    const rehearsal = workflow.slice(workflow.indexOf('  glasgow-preview-rehearsal:'));
    const preflight = rehearsal.indexOf('scripts/verify-glasgow-2026-preview-freshness.ts');
    expect(preflight).toBeGreaterThan(-1);
    for (const marker of [
      'run: npm run db:reset:glasgow-preview',
      'run: npm run db:prepare:glasgow',
      'run: npm run db:import:glasgow -- data/glasgow-2026/v1/bundle.json --record-preview',
      'run: npx tsx scripts/rehearse-glasgow-2026-rollback.ts',
    ]) {
      expect(preflight).toBeLessThan(rehearsal.indexOf(marker));
    }
    const freshness = await readFile(
      path.resolve('scripts/verify-glasgow-2026-preview-freshness.ts'),
      'utf8',
    );
    expect(freshness).not.toMatch(/\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\(/);
  });
});
