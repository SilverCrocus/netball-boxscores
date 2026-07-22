import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const migration = read('prisma/migrations/20260722000000_add_analytics_cache_epoch/migration.sql');
const analyticsRole = read('scripts/provision-analytics-role.sql');
const queryPlans = read('scripts/check-analytics-query-plans.sql');

const sourceTriggers = [
  'analytics_competition_series_cache_invalidation',
  'analytics_competition_cache_invalidation',
  'analytics_stage_cache_invalidation',
  'analytics_stage_group_cache_invalidation',
  'analytics_edition_entry_cache_invalidation',
  'analytics_roster_membership_cache_invalidation',
  'analytics_player_cache_invalidation',
  'analytics_team_cache_invalidation',
  'analytics_data_coverage_cache_invalidation',
  'analytics_import_run_cache_invalidation',
  'analytics_source_system_cache_invalidation',
  'analytics_match_slot_cache_invalidation',
] as const;

describe('analytics cache epoch migration contract', () => {
  it('creates and deterministically seeds one private global epoch', () => {
    expect(migration).toContain('CREATE TABLE analytics.cache_epoch');
    expect(migration).toContain(
      "INSERT INTO analytics.cache_epoch (singleton_id, revision, invalidated_at)\nVALUES (true, 1, TIMESTAMPTZ '1970-01-01 00:00:00+00')",
    );
    expect(migration).toContain('ALTER TABLE analytics.cache_epoch ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain(
      'REVOKE ALL ON analytics.cache_epoch FROM PUBLIC, anon, authenticated, service_role',
    );
    expect(migration).toContain('CREATE OR REPLACE VIEW analytics.cache_revision_read AS');
    expect(migration).toContain('FROM analytics.cache_epoch epoch');
    expect(migration).toContain("'analytics-cache-epoch.v1'::TEXT AS contract_version");
    expect(migration).not.toMatch(/MAX\(invalidation\.revision\)/u);
  });

  it('covers every fact, directory, publication, and readiness source with delete triggers', () => {
    for (const table of [
      '"Match"',
      '"PlayerMatchStats"',
      '"TeamMatchStats"',
      '"DataCoverage"',
      '"Competition"',
      '"CompetitionSeries"',
      '"Stage"',
      '"StageGroup"',
      '"EditionEntry"',
      '"RosterMembership"',
      '"Player"',
      '"Team"',
      '"ImportRun"',
      '"SourceSystem"',
      '"MatchSlot"',
    ]) {
      expect(migration).toContain(`ON public.${table}`);
    }
    for (const trigger of sourceTriggers) {
      expect(migration).toContain(`CREATE TRIGGER ${trigger}`);
    }
    expect(migration.match(/OR DELETE/g)?.length).toBeGreaterThanOrEqual(sourceTriggers.length + 3);
    expect(migration).toContain("TG_OP IN ('UPDATE', 'DELETE')");
    expect(migration).toContain('OLD."matchId"');
    expect(migration).toContain('NEW IS NOT DISTINCT FROM OLD');
    expect(migration).toContain('NEW."capability" IN (');
    expect(migration).toContain('OLD."capability" IN (');
    expect(migration).toContain('NEW."stageId" IS DISTINCT FROM OLD."stageId"');
    expect(migration).toContain("competition.\"slug\" = 'glasgow-2026'");
    expect(migration).not.toMatch(/"stageGroupId", "updatedAt"/u);
    expect(migration).toContain('PERFORM analytics.advance_cache_epoch()');
    expect(migration).toContain(
      "IF TG_OP <> 'DELETE' AND new_is_eligible THEN",
    );
    expect(migration).toContain(
      "ELSIF TG_OP = 'UPDATE' AND old_is_eligible THEN",
    );
  });

  it('keeps the runtime role surface unchanged and adds a bounded epoch plan', () => {
    expect(analyticsRole).not.toContain('cache_epoch');
    expect(analyticsRole).not.toContain('advance_cache_epoch');
    expect(queryPlans).toContain('FROM analytics.cache_revision_read');
    expect(migration).not.toMatch(/CREATE MATERIALIZED VIEW/u);
    expect(migration).not.toContain('INSERT INTO analytics.ranking_snapshot');
    expect(migration).not.toContain('INSERT INTO analytics.record_entry');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION analytics.advance_cache_epoch()\n  FROM PUBLIC, anon, authenticated, service_role',
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION analytics.queue_match_invalidation()\n  FROM PUBLIC, anon, authenticated, service_role',
    );
  });
});
