import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  projectRefFromPreviewDatabaseUrl,
  verifyPreviewDatabaseTarget,
} from '../../../scripts/lib/preview-database-target';

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
  it('installs dependencies, deploys and verifies migrations, proves rollback, and never publishes', async () => {
    const workflow = await readFile(path.resolve('.github/workflows/ci.yml'), 'utf8');
    const rehearsal = workflow.slice(workflow.indexOf('  glasgow-preview-rehearsal:'));
    const migrationRehearsal = await readFile(
      path.resolve('scripts/rehearse-complete-prisma-migrations.ts'),
      'utf8',
    );

    expect(rehearsal).toContain('npm ci');
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
    expect(rehearsal).toContain('npx tsx scripts/verify-preview-prisma-baseline.ts --resolve');
    expect(rehearsal).toContain('npx prisma migrate deploy');
    expect(rehearsal).toContain('npx tsx scripts/verify-preview-migrations.ts');
    expect(rehearsal).toContain('npx tsx scripts/rehearse-glasgow-2026-rollback.ts');
    expect(rehearsal).toContain('db:publish:edition -- commonwealth-games-netball glasgow-2026 --dry-run');
    expect(rehearsal).not.toMatch(/db:publish:edition[^\n]*--apply/);
  });
});
