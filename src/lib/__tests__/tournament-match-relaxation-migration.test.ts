import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const migrationPath = path.join(
  process.cwd(),
  'prisma',
  'migrations',
  '20260715010000_relax_tournament_matches',
  'migration.sql'
);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf-8');
}

describe('CP-02B tournament match relaxation migration', () => {
  it('is atomic and contains no data mutation', () => {
    const sql = readMigration().trim();
    expect(sql).toMatch(/^--[\s\S]*\nBEGIN;/);
    expect(sql).toMatch(/COMMIT;$/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s+(INTO|FROM|"Competition"|"Match")/i);
  });

  it('makes only the planned compatibility columns nullable', () => {
    const sql = readMigration();
    expect(sql).toContain('ALTER COLUMN "championDataId" DROP NOT NULL');
    expect(sql).toContain('ALTER COLUMN "homeTeamId" DROP NOT NULL');
    expect(sql).toContain('ALTER COLUMN "awayTeamId" DROP NOT NULL');
    expect(sql).toContain('ALTER COLUMN "round" DROP NOT NULL');
  });

  it('adds every provider-neutral lifecycle status', () => {
    const sql = readMigration();
    for (const status of ['DELAYED', 'POSTPONED', 'CANCELLED', 'ABANDONED']) {
      expect(sql).toContain(`ADD VALUE IF NOT EXISTS '${status}'`);
    }
  });

  it('verifies foreign keys, indexes, RLS, and rolling-deploy compatibility', () => {
    const sql = readMigration();
    expect(sql).toContain('Match_homeTeamId_fkey');
    expect(sql).toContain('Match_awayTeamId_fkey');
    expect(sql).toContain('Competition_championDataId_key');
    expect(sql).toContain('Match_homeTeamId_scheduledAt_idx');
    expect(sql).toContain('Match_awayTeamId_scheduledAt_idx');
    expect(sql).toContain('relrowsecurity = false');
    expect(sql).toContain('unresolved data predates compatible application deploy');
  });
});
