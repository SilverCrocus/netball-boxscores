import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertHistoricalEpochContractPending,
  assertNoMaterializedPendingObjects,
  extractNewPendingObjectIdentities,
  type MigrationDescriptor,
  validatePreviewPrismaLedger,
} from '../../../scripts/lib/preview-prisma-ledger-contract';

const PREFIX_NAMES = [
  '20260602_expand_stats_fields',
  '20260712000000_add_hot_query_indexes',
  '20260712010000_harden_public_schema',
  '20260712020000_add_finals_match_metadata',
  '20260715000000_add_competition_foundation',
  '20260715010000_relax_tournament_matches',
  '20260715020000_add_analytics_foundation',
  '20260715021000_optimize_analytics_coverage_views',
  '20260715022000_index_analytics_foreign_keys',
  '20260715023000_extend_analytics_metric_contracts',
  '20260716093000_add_player_photo_provenance',
  '20260716095500_harden_prisma_migration_ledger',
  '20260717000000_secure_analytics_query_boundary',
  '20260717010000_close_postgres17_maintain_acl',
  '20260722000000_add_analytics_cache_epoch',
] as const;
const EPOCH_MIGRATION = '20260722000000_add_analytics_cache_epoch';
const PENDING = '20260722010000_repair_analytics_cache_epoch_contract';

function descriptors(): MigrationDescriptor[] {
  return PREFIX_NAMES.map((migrationName, index) => ({
    migrationName,
    checksum: index.toString(16).padStart(64, '0'),
  }));
}

function validRows() {
  return descriptors().map((migration, index) => ({
    ...migration,
    finishedAt: new Date(`2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
    rolledBackAt: null,
  }));
}

describe('preview Prisma baseline ledger contract', () => {
  it('accepts an empty ledger and the exact reusable 15-row prefix', () => {
    expect(validatePreviewPrismaLedger([], descriptors(), PENDING).mode).toBe('empty');
    expect(validatePreviewPrismaLedger(validRows(), descriptors(), PENDING)).toMatchObject({
      mode: 'reuse',
      pendingMigrationName: PENDING,
    });
  });

  it('accepts the historical epoch contract and rejects any partially applied repair', () => {
    const historical = {
      cacheRevisionReadColumns: ['revision', 'invalidated_at'],
      queueFunctionDefinition: 'CREATE FUNCTION queue_match_invalidation() source_relevant;',
      matchTriggerDefinitions: ['CREATE TRIGGER ... UPDATE OF "stageGroupId", "updatedAt"'],
    };
    expect(() => assertHistoricalEpochContractPending(historical)).not.toThrow();

    expect(() => assertHistoricalEpochContractPending({
      ...historical,
      cacheRevisionReadColumns: ['revision', 'invalidated_at', 'contract_version'],
    })).toThrow('cache_revision_read');
    expect(() => assertHistoricalEpochContractPending({
      ...historical,
      queueFunctionDefinition: `${historical.queueFunctionDefinition} new_is_glasgow`,
    })).toThrow('queue_match_invalidation()');
    expect(() => assertHistoricalEpochContractPending({
      ...historical,
      matchTriggerDefinitions: [],
    })).toThrow('Match lifecycle trigger');
    expect(() => assertHistoricalEpochContractPending({
      ...historical,
      matchTriggerDefinitions: ['CREATE TRIGGER ... UPDATE OF "stageGroupId"'],
    })).toThrow('column list');
  });

  it.each([
    ['changed checksum', () => validRows().map((row, index) => index === 2 ? { ...row, checksum: 'f'.repeat(64) } : row)],
    ['unknown migration', () => validRows().map((row, index) => index === 2 ? { ...row, migrationName: '99999999999999_unknown' } : row)],
    ['duplicate migration', () => validRows().map((row, index, rows) => index === 2 ? { ...row, migrationName: rows[1]!.migrationName } : row)],
    ['incomplete prefix', () => validRows().slice(0, -1)],
    ['rolled-back migration', () => validRows().map((row, index) => index === 3 ? { ...row, rolledBackAt: new Date() } : row)],
    ['unfinished migration', () => validRows().map((row, index) => index === 4 ? { ...row, finishedAt: null } : row)],
    ['non-contiguous prefix', () => validRows().map((row, index, rows) => index === 1 ? rows[2]! : index === 2 ? rows[1]! : row)],
    ['pending migration present', () => [...validRows().slice(0, -1), {
      migrationName: PENDING,
      checksum: 'e'.repeat(64),
      finishedAt: null,
      rolledBackAt: null,
    }]],
  ] as const)('rejects %s', (_label, makeRows) => {
    expect(() => validatePreviewPrismaLedger(makeRows(), descriptors(), PENDING))
      .toThrow('Preview Prisma baseline verification failed:');
  });

  it('derives pending relations/functions/triggers from SQL and rejects partial materialization', async () => {
    const pendingSql = await readFile(path.resolve(
      'prisma/migrations', EPOCH_MIGRATION, 'migration.sql',
    ), 'utf8');
    const precedingSql = await Promise.all(PREFIX_NAMES.slice(0, -1).map((migration) => readFile(path.resolve(
      'prisma/migrations', migration, 'migration.sql',
    ), 'utf8')));
    const objects = extractNewPendingObjectIdentities(pendingSql, precedingSql);

    expect(objects.relations.map((object) => object.identity)).toEqual(['analytics.cache_epoch']);
    expect(objects.functions.map((object) => object.identity)).toEqual(['analytics.advance_cache_epoch()']);
    expect(objects.triggers.map((object) => object.identity)).toEqual([
      'public.Competition.analytics_competition_cache_invalidation',
      'public.CompetitionSeries.analytics_competition_series_cache_invalidation',
      'public.DataCoverage.analytics_data_coverage_cache_invalidation',
      'public.EditionEntry.analytics_edition_entry_cache_invalidation',
      'public.ImportRun.analytics_import_run_cache_invalidation',
      'public.MatchSlot.analytics_match_slot_cache_invalidation',
      'public.Player.analytics_player_cache_invalidation',
      'public.RosterMembership.analytics_roster_membership_cache_invalidation',
      'public.SourceSystem.analytics_source_system_cache_invalidation',
      'public.Stage.analytics_stage_cache_invalidation',
      'public.StageGroup.analytics_stage_group_cache_invalidation',
      'public.Team.analytics_team_cache_invalidation',
    ]);
    expect(objects.functions).not.toContainEqual(expect.objectContaining({ identity: 'analytics.queue_match_invalidation()' }));
    expect(objects.triggers).not.toContainEqual(expect.objectContaining({
      identity: 'public.Match.analytics_match_finalization_invalidation',
    }));
    expect(() => assertNoMaterializedPendingObjects(objects, {
      relations: [],
      functions: [],
      triggers: [],
    })).not.toThrow();
    expect(() => assertNoMaterializedPendingObjects(objects, {
      relations: [objects.relations[0]!],
      functions: [],
      triggers: [],
    })).toThrow('analytics.cache_epoch');
  });

  it('pins the forward repair as a replacement-only migration with the final contract', async () => {
    const repair = await readFile(path.resolve(
      'prisma/migrations', PENDING, 'migration.sql',
    ), 'utf8');

    expect(repair).toContain('CREATE OR REPLACE VIEW analytics.cache_revision_read AS');
    expect(repair).toContain("'analytics-cache-epoch.v1'::TEXT AS contract_version");
    expect(repair).toContain('CREATE OR REPLACE FUNCTION analytics.queue_match_invalidation()');
    expect(repair).toContain('new_is_glasgow BOOLEAN := false');
    expect(repair).toContain('glasgow_structural_changed BOOLEAN := false');
    expect(repair).toContain('NEW IS NOT DISTINCT FROM OLD');
    expect(repair).toContain("'SUPER_SHOTS'::public.\"DataCapability\"");
    expect(repair).toContain('DROP TRIGGER IF EXISTS analytics_match_finalization_invalidation');
    expect(repair).toContain('"awayScore", "stageId", "stageGroupId"\n  OR DELETE');
    expect(repair).not.toContain('"stageGroupId", "updatedAt"');
    expect(repair).not.toMatch(/CREATE TABLE|CREATE TYPE|CREATE INDEX|ADD COLUMN/u);
    expect(repair.match(/DROP TRIGGER IF EXISTS/g)?.length).toBe(1);
    expect(repair).toContain('SET search_path = \'\'');
    expect(repair).toContain(
      'REVOKE ALL ON FUNCTION analytics.queue_match_invalidation()\n  FROM PUBLIC, anon, authenticated, service_role',
    );
  });
});
