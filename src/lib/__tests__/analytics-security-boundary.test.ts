import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const migration = read('prisma/migrations/20260717000000_secure_analytics_query_boundary/migration.sql');
const analyticsRole = read('scripts/provision-analytics-role.sql');
const operationsRole = read('scripts/provision-stats-operations-role.sql');
const queryPlanChecks = read('scripts/check-analytics-query-plans.sql');
const readinessRoute = read('src/app/api/readiness/route.ts');

const ANALYTICS_VIEW_ALLOWLIST = [
  'competition_directory',
  'player_match_read',
  'team_match_read',
  'player_directory',
  'team_directory',
  'player_alias_directory',
  'team_alias_directory',
  'stage_directory',
  'stage_group_directory',
  'player_edition_directory',
  'team_edition_directory',
  'team_power_match',
  'opponent_match_directory',
  'cache_revision_read',
] as const;

describe('secure analytics query boundary', () => {
  it('closes current and postgres-owned future public Data API grants, including service_role', () => {
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role');
    expect(migration.match(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public/g)).toHaveLength(3);
    expect(migration).toContain('REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES\n  FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain('REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).not.toContain('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin');
    expect(migration).not.toContain("to_regrole('supabase_admin')");
    expect(migration).not.toContain("pg_has_role(CURRENT_USER, 'supabase_admin'");
    for (const legacyFunction of [
      'cp_prepare_legacy_match_write',
      'cp_sync_legacy_match_foundation',
      'cp_validate_competition_topology',
    ]) {
      expect(migration).toContain(
        `REVOKE EXECUTE ON FUNCTION public.${legacyFunction}()\n  FROM PUBLIC, anon, authenticated, service_role`,
      );
    }
  });

  it('creates only private, coverage-gated directory and read views', () => {
    for (const view of ANALYTICS_VIEW_ALLOWLIST) {
      expect(migration).toContain(`CREATE VIEW analytics.${view}`);
      expect(migration).toContain(`REVOKE ALL ON analytics.${view} FROM PUBLIC, anon, authenticated, service_role`);
    }
    expect(migration).toContain(`competition."publicationStatus" = 'PUBLISHED'`);
    expect(migration).toContain(`eligible_match."status" = 'COMPLETED'`);
    expect(migration).toContain(`eligible_match."isSimulation" = false`);
    expect(migration).toContain(`source_system."key" = 'glasgow-2026-public-data'`);
    expect(migration).toContain(') = 76');
  });

  it('resolves shared international players through their match-edition roster', () => {
    expect(migration).toContain('CREATE OR REPLACE VIEW analytics.player_match_fact');
    expect(migration).toContain('entry."competitionId" = eligible.competition_id');
    expect(migration).toContain('entry."teamId" IN (eligible.home_team_id, eligible.away_team_id)');
    expect(migration).toContain("WHEN 'REPLACED'::public.\"RosterMembershipStatus\" THEN 1");
    expect(migration).toContain('COALESCE(edition_roster.designated_position, player."position"::TEXT)');
    expect(migration).toContain('WHEN player."teamId" IN (eligible.home_team_id, eligible.away_team_id)');
    expect(migration).not.toContain('JOIN public."Team" team ON team."id" = player."teamId"');
  });

  it('carries edition-specific roster or match positions into public directories', () => {
    const editionDirectory = migration.match(
      /CREATE VIEW analytics\.player_edition_directory[\s\S]*?CREATE VIEW analytics\.player_directory/,
    )?.[0] ?? '';
    const playerDirectory = migration.match(
      /CREATE VIEW analytics\.player_directory[\s\S]*?CREATE VIEW analytics\.team_directory/,
    )?.[0] ?? '';

    expect(editionDirectory).toContain('membership."designatedPosition"::TEXT AS position');
    expect(editionDirectory).toContain('fact.position');
    expect(editionDirectory).toContain(
      'COALESCE(edition_players.position, player."position"::TEXT) AS position',
    );
    expect(playerDirectory).toContain('edition_player.position');
    expect(playerDirectory).not.toContain('player."position"::TEXT AS position');
  });

  it('does not grant unpublished raw facts to the public analytics login', () => {
    expect(migration).toContain('CREATE VIEW analytics.player_match_read');
    expect(migration).toContain('CREATE VIEW analytics.team_match_read');
    expect(migration.match(/JOIN analytics\.competition_directory competition/g)?.length).toBeGreaterThanOrEqual(2);
    expect(analyticsRole).not.toContain('GRANT SELECT ON analytics.player_match_fact');
    expect(analyticsRole).not.toContain('GRANT SELECT ON analytics.team_match_fact');
    expect(read('src/lib/analytics/repository.ts')).not.toMatch(/FROM analytics\.(player_match_fact|team_match_fact)/);
  });

  it('filters unpublished stages while retaining legacy matches without a stage', () => {
    const playerRead = migration.match(
      /CREATE VIEW analytics\.player_match_read[\s\S]*?CREATE VIEW analytics\.team_match_read/,
    )?.[0] ?? '';
    const teamRead = migration.match(
      /CREATE VIEW analytics\.team_match_read[\s\S]*?CREATE VIEW analytics\.team_edition_directory/,
    )?.[0] ?? '';
    const teamPower = migration.match(
      /CREATE VIEW analytics\.team_power_match[\s\S]*?CREATE VIEW analytics\.opponent_match_directory/,
    )?.[0] ?? '';
    const opponents = migration.match(
      /CREATE VIEW analytics\.opponent_match_directory[\s\S]*?CREATE VIEW analytics\.cache_revision_read/,
    )?.[0] ?? '';

    for (const viewSql of [playerRead, teamRead]) {
      expect(viewSql).toContain('LEFT JOIN public."Stage" stage');
      expect(viewSql).toContain('fact.stage_id IS NULL');
      expect(viewSql).toContain('stage."isPublished" = true');
    }
    for (const viewSql of [teamPower, opponents]) {
      expect(viewSql).toContain('LEFT JOIN public."Stage" stage');
      expect(viewSql).toContain('eligible.stage_id IS NULL');
      expect(viewSql).toContain('stage."isPublished" = true');
    }
    expect(migration).toMatch(
      /CREATE VIEW analytics\.stage_directory[\s\S]*?WHERE stage\."isPublished" = true;/,
    );
    expect(migration).toContain(
      'JOIN analytics.stage_directory stage ON stage.stage_id = stage_group."stageId"',
    );
  });

  it('separates durable rate-limit storage from query telemetry', () => {
    expect(migration).toContain('CREATE TABLE analytics.query_rate_limit_bucket');
    expect(migration).not.toMatch(/INSERT INTO analytics\.query_telemetry[\s\S]*RATE_LIMIT_RESERVATION/);
    expect(migration).toContain('PRIMARY KEY (key_hash, bucket_started_at)');
  });

  it('locks both operations functions to an empty search path and revokes default execution', () => {
    expect(migration.match(/SECURITY DEFINER\nSET search_path = ''/g)).toHaveLength(2);
    expect(migration).toContain('FUNCTION analytics.reserve_stat_query_rate_limit(p_key_hash TEXT)');
    expect(migration).toContain('FUNCTION analytics.write_stat_query_telemetry(');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain("p_question_hash !~ '^[0-9a-f]{64}$'");
    expect(migration).toContain("pg_catalog.jsonb_typeof(p_query_spec) <> 'object'");
    expect(migration).toContain('pg_catalog.pg_column_size(p_query_spec) > 16384');
    expect(migration).not.toContain('pg_catalog.extract(');
  });

  it('grants the analytics login an exact static view allowlist', () => {
    for (const view of ANALYTICS_VIEW_ALLOWLIST) {
      expect(analyticsRole).toContain(`GRANT SELECT ON analytics.${view} TO centrepass_analytics;`);
    }
    expect(analyticsRole).not.toContain("SELECT format('GRANT SELECT ON %I.%I TO centrepass_analytics'");
    expect(analyticsRole).toContain('exact_view_allowlist_ok');
    expect(analyticsRole).toContain('no_schema_create');
    expect(analyticsRole).toContain('role_attributes_ok');
    expect(analyticsRole).toContain('no_role_memberships');
    expect(analyticsRole).toContain('no_sequence_privileges');
    expect(analyticsRole).toContain('no_application_function_execution');
    expect(analyticsRole).toContain('default_transaction_read_only = on');
    expect(analyticsRole).toContain("statement_timeout = %L");
    expect(analyticsRole).not.toContain('\\quit');
    expect(analyticsRole).toContain('RAISE EXCEPTION');
    const plannedViews = [...queryPlanChecks.matchAll(/analytics\.([a-z_]+)/g)]
      .map((match) => match[1]);
    expect(plannedViews.length).toBeGreaterThan(0);
    for (const view of plannedViews) expect(ANALYTICS_VIEW_ALLOWLIST).toContain(view);
  });

  it('grants the operations login EXECUTE only and no relation privileges', () => {
    expect(operationsRole).toContain('CREATE ROLE centrepass_stats_operations LOGIN NOINHERIT');
    expect(operationsRole).toContain('GRANT EXECUTE ON FUNCTION analytics.reserve_stat_query_rate_limit(TEXT)');
    expect(operationsRole).toContain('GRANT EXECUTE ON FUNCTION analytics.write_stat_query_telemetry');
    expect(operationsRole).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM centrepass_stats_operations');
    expect(operationsRole).toContain('no_relation_privileges');
    expect(operationsRole).toContain('role_attributes_ok');
    expect(operationsRole).toContain('no_role_memberships');
    expect(operationsRole).toContain('no_sequence_privileges');
    expect(operationsRole).toContain('exact_function_allowlist_ok');
    expect(operationsRole).toContain('no_schema_create');
    expect(operationsRole).not.toContain('GRANT SELECT ON');
    expect(operationsRole).not.toContain('default_transaction_read_only = on');
    expect(operationsRole).not.toContain('\\quit');
    expect(operationsRole).toContain('RAISE EXCEPTION');
  });

  it('makes readiness prove both scoped role contracts instead of connection liveness', () => {
    expect(readinessRoute).toContain("CURRENT_USER = 'centrepass_analytics'");
    expect(readinessRoute).toContain("CURRENT_USER = 'centrepass_stats_operations'");
    expect(readinessRoute).toContain("current_setting('default_transaction_read_only', true) = 'on'");
    expect(readinessRoute.match(/current_setting\('statement_timeout'\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(readinessRoute.match(/statementTimeoutOk/g)?.length).toBeGreaterThanOrEqual(4);
    expect(readinessRoute).not.toContain('pg_catalog.extract(');
    expect(readinessRoute.match(/role_attributes_ok/g)?.length).toBeGreaterThanOrEqual(2);
    expect(readinessRoute.match(/no_role_memberships/g)?.length).toBeGreaterThanOrEqual(2);
    expect(readinessRoute.match(/no_sequence_privileges/g)?.length).toBeGreaterThanOrEqual(2);
    expect(readinessRoute).toContain('no_function_privileges');
    expect(readinessRoute).toContain('exact_function_surface_ok');
  });

  it('keeps every public analytics service off the general Prisma client', () => {
    for (const path of [
      'src/lib/player-analytics.ts',
      'src/lib/rankings/service.ts',
      'src/lib/records/service.ts',
      'src/lib/comparison/service.ts',
      'src/lib/stat-query/context.ts',
      'src/lib/stat-query/executor.ts',
      'src/lib/stat-query/operations.ts',
    ]) {
      expect(read(path), path).not.toContain("from '@/lib/db'");
    }
    expect(read('src/lib/analytics/repository.ts')).toContain('getAnalyticsDatabase');
    expect(read('src/lib/stat-query/operations.ts')).toContain('getStatsOperationsDatabase');
    const scopedClients = read('src/lib/scoped-database-clients.ts');
    expect(scopedClients).toContain("url.searchParams.set('pgbouncer', 'true')");
    expect(scopedClients).toContain("url.searchParams.set('pool_timeout', '5')");
  });

  it('ships disabled feature switches and a reproducible production runtime', () => {
    const blueprint = read('render.yaml');
    expect(blueprint).toContain('key: NODE_VERSION\n        value: 24.14.1');
    expect(blueprint).toContain('key: ANALYTICS_FEATURES_ENABLED\n        value: "false"');
    expect(blueprint).toContain('key: ASK_CENTREPASS_ENABLED\n        value: "false"');
  });
});
