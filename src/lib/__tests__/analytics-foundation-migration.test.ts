import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'prisma/migrations/20260715020000_add_analytics_foundation/migration.sql'),
  'utf8',
);
const optimization = readFileSync(
  join(process.cwd(), 'prisma/migrations/20260715021000_optimize_analytics_coverage_views/migration.sql'),
  'utf8',
);
const foreignKeyIndexes = readFileSync(
  join(process.cwd(), 'prisma/migrations/20260715022000_index_analytics_foreign_keys/migration.sql'),
  'utf8',
);

describe('analytics foundation migration', () => {
  it('creates a private schema and revokes every Data API role', () => {
    expect(migration).toContain('CREATE SCHEMA IF NOT EXISTS analytics');
    expect(migration).toContain('REVOKE ALL ON SCHEMA analytics FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM PUBLIC, anon, authenticated');
  });

  it('centralizes final match eligibility and coverage precedence', () => {
    expect(migration).toContain('CREATE VIEW analytics.eligible_match');
    expect(migration).toContain(`m.\"status\" = 'COMPLETED'`);
    expect(migration).toContain(`'OFFICIAL_FINAL'::public.\"ResultQualityStatus\"`);
    expect(migration).toContain(`'CORRECTED'::public.\"ResultQualityStatus\"`);
    expect(migration).toContain('AND m.\"isSimulation\" = false');
    expect(migration).toContain('COALESCE(match_coverage.\"state\", edition_coverage.\"state\"');
  });

  it('defines facts, summaries, form, and position-compatible populations', () => {
    expect(migration).toContain('CREATE VIEW analytics.player_match_fact');
    expect(migration).toContain('CREATE VIEW analytics.team_match_fact');
    expect(migration).toContain('CREATE VIEW analytics.player_edition_summary');
    expect(migration).toContain('CREATE VIEW analytics.team_edition_summary');
    expect(migration).toContain('CREATE VIEW analytics.player_form');
    expect(migration).toContain('CREATE VIEW analytics.player_edition_population');
    expect(migration).toContain('PARTITION BY summary.competition_kind, summary.competition_id, summary.position');
  });

  it('uses weighted shooting percentage and deterministic last-match ordering', () => {
    expect(migration).toContain('SUM(fact.goals)::DOUBLE PRECISION / NULLIF(SUM(fact.attempts), 0) * 100');
    expect(migration).toContain('ORDER BY fact.scheduled_at DESC, fact.match_id DESC');
  });

  it('resolves box-score coverage once per match for predicate-friendly plans', () => {
    expect(optimization).toContain('CREATE VIEW analytics.match_coverage');
    expect(optimization).toContain('JOIN analytics.match_coverage coverage ON coverage.match_id = em.match_id');
    expect(optimization).not.toContain('JOIN analytics.match_capability_coverage player_coverage');
    expect(optimization).toContain('ALTER VIEW analytics.player_match_fact RESET (security_barrier)');
  });

  it('owns all leaf persistence contracts and finalization invalidation hooks', () => {
    expect(migration).toContain('CREATE TABLE analytics.ranking_snapshot');
    expect(migration).toContain('CREATE TABLE analytics.record_entry');
    expect(migration).toContain('CREATE TABLE analytics.query_telemetry');
    expect(migration).toContain('CREATE TABLE analytics.cache_invalidation');
    expect(migration).toContain('analytics_match_finalization_invalidation');
    expect(migration).toContain('analytics_player_stats_invalidation');
    expect(migration).toContain('analytics_team_stats_invalidation');
  });

  it('covers analytics foreign keys used during source corrections and deletion', () => {
    expect(foreignKeyIndexes).toContain('cache_invalidation_competition_idx');
    expect(foreignKeyIndexes).toContain('record_entry_competition_idx');
    expect(foreignKeyIndexes).toContain('record_entry_supporting_match_idx');
    expect(foreignKeyIndexes).toContain('record_entry_supporting_competition_idx');
    expect(foreignKeyIndexes).toContain('record_entry_supersedes_idx');
  });
});
