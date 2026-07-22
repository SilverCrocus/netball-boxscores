export interface PreviewMigrationLedgerRow {
  migrationName: string;
  checksum: string;
  finishedAt: unknown;
  rolledBackAt: unknown;
}

export interface MigrationDescriptor {
  migrationName: string;
  checksum: string;
}

export type PreviewLedgerMode = 'empty' | 'reuse';

export interface PreviewLedgerValidation {
  mode: PreviewLedgerMode;
  expectedPrefix: MigrationDescriptor[];
  pendingMigrationName: string;
}

export const EXPECTED_PREVIEW_PRISMA_MIGRATIONS = [
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
  '20260722010000_repair_analytics_cache_epoch_contract',
] as const;

export interface PendingRelationIdentity {
  kind: 'relation';
  schema: string;
  name: string;
  identity: string;
}

export interface PendingFunctionIdentity {
  kind: 'function';
  schema: string;
  name: string;
  identity: string;
}

export interface PendingTriggerIdentity {
  kind: 'trigger';
  schema: string;
  table: string;
  name: string;
  identity: string;
}

export interface PendingObjectIdentities {
  relations: PendingRelationIdentity[];
  functions: PendingFunctionIdentity[];
  triggers: PendingTriggerIdentity[];
}

export interface HistoricalEpochContractEvidence {
  cacheRevisionReadColumns: readonly string[];
  queueFunctionDefinition: string;
  matchTriggerDefinitions: readonly string[];
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Preview Prisma baseline verification failed: ${message}`);
}

function unquote(identifier: string): string {
  if (identifier.startsWith('"') && identifier.endsWith('"')) {
    return identifier.slice(1, -1).replaceAll('""', '"');
  }
  return identifier;
}

function qualifiedIdentity(raw: string): { schema: string; name: string; identity: string } {
  const separator = raw.indexOf('.');
  const schema = separator > 0 ? unquote(raw.slice(0, separator)) : 'public';
  const name = unquote(separator > 0 ? raw.slice(separator + 1) : raw);
  invariant(name.length > 0, `migration object identity is invalid: ${raw}`);
  invariant(/^[A-Za-z_][A-Za-z0-9_$]*$/.test(schema), `migration object schema is invalid: ${raw}`);
  invariant(/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name), `migration object name is invalid: ${raw}`);
  return { schema, name, identity: `${schema}.${name}` };
}

function parseMigrationObjects(sql: string): PendingObjectIdentities {
  const relations: PendingRelationIdentity[] = [];
  const functions: PendingFunctionIdentity[] = [];
  const triggers: PendingTriggerIdentity[] = [];

  for (const match of sql.matchAll(/^\s*CREATE(?: OR REPLACE)? TABLE\s+([^\s(]+)/gim)) {
    const identity = qualifiedIdentity(match[1]!);
    relations.push({ kind: 'relation', ...identity });
  }
  for (const match of sql.matchAll(/^\s*CREATE(?: OR REPLACE)? VIEW\s+([^\s(]+)/gim)) {
    const identity = qualifiedIdentity(match[1]!);
    relations.push({ kind: 'relation', ...identity });
  }
  for (const match of sql.matchAll(/^\s*CREATE(?: OR REPLACE)? FUNCTION\s+([^\s(]+)\s*\(([^)]*)\)/gim)) {
    const identity = qualifiedIdentity(match[1]!);
    functions.push({
      kind: 'function',
      schema: identity.schema,
      name: identity.name,
      identity: `${identity.identity}(${match[2]!.trim()})`,
    });
  }
  for (const match of sql.matchAll(/^\s*CREATE TRIGGER\s+([^\s]+)[\s\S]*?\sON\s+([^\s]+)/gim)) {
    const trigger = unquote(match[1]!);
    const table = qualifiedIdentity(match[2]!);
    invariant(/^[A-Za-z_][A-Za-z0-9_$]*$/.test(trigger),
      `migration trigger name is invalid: ${match[1]}`);
    triggers.push({
      kind: 'trigger',
      schema: table.schema,
      table: table.name,
      name: trigger,
      identity: `${table.identity}.${trigger}`,
    });
  }

  const statementCounts = {
    relations: [...sql.matchAll(/^\s*CREATE(?: OR REPLACE)? (?:TABLE|VIEW)\b/gim)].length,
    functions: [...sql.matchAll(/^\s*CREATE(?: OR REPLACE)? FUNCTION\b/gim)].length,
    triggers: [...sql.matchAll(/^\s*CREATE TRIGGER\b/gim)].length,
  };
  invariant(relations.length === statementCounts.relations
    && functions.length === statementCounts.functions
    && triggers.length === statementCounts.triggers,
  'pending migration object parser did not account for every CREATE object statement');

  return { relations, functions, triggers };
}

function objectKey(object: PendingObjectIdentities[keyof PendingObjectIdentities][number]): string {
  return `${object.kind}:${object.identity}`;
}

function uniqueObjects<T extends { identity: string }>(objects: T[]): T[] {
  return [...new Map(objects.map((object) => [object.identity, object])).values()]
    .sort((left, right) => left.identity.localeCompare(right.identity));
}

export function extractNewPendingObjectIdentities(
  pendingSql: string,
  precedingMigrationSql: readonly string[],
): PendingObjectIdentities {
  const pending = parseMigrationObjects(pendingSql);
  const preceding = precedingMigrationSql.reduce<PendingObjectIdentities>((combined, sql) => {
    const objects = parseMigrationObjects(sql);
    combined.relations.push(...objects.relations);
    combined.functions.push(...objects.functions);
    combined.triggers.push(...objects.triggers);
    return combined;
  }, { relations: [], functions: [], triggers: [] });
  const precedingKeys = new Set([
    ...preceding.relations.map(objectKey),
    ...preceding.functions.map(objectKey),
    ...preceding.triggers.map(objectKey),
  ]);
  return {
    relations: uniqueObjects(pending.relations.filter((object) => !precedingKeys.has(objectKey(object)))),
    functions: uniqueObjects(pending.functions.filter((object) => !precedingKeys.has(objectKey(object)))),
    triggers: uniqueObjects(pending.triggers.filter((object) => !precedingKeys.has(objectKey(object)))),
  };
}

export function assertNoMaterializedPendingObjects(
  expected: PendingObjectIdentities,
  actual: PendingObjectIdentities,
): void {
  const expectedKeys = new Set([
    ...expected.relations.map(objectKey),
    ...expected.functions.map(objectKey),
    ...expected.triggers.map(objectKey),
  ]);
  const actualKeys = [
    ...actual.relations.map(objectKey),
    ...actual.functions.map(objectKey),
    ...actual.triggers.map(objectKey),
  ].filter((key) => expectedKeys.has(key)).sort((left, right) => left.localeCompare(right));
  invariant(actualKeys.length === 0,
    `pending migration is partially materialized: ${[...new Set(actualKeys)].join(', ')}`);
}

export function assertHistoricalEpochContractPending(
  evidence: HistoricalEpochContractEvidence,
): void {
  invariant(JSON.stringify(evidence.cacheRevisionReadColumns) ===
    JSON.stringify(['revision', 'invalidated_at']),
  'repair migration is partially materialized: cache_revision_read is not the historical two-column contract');
  invariant(evidence.queueFunctionDefinition.length > 0,
    'repair migration is partially materialized: queue_match_invalidation() is missing');
  for (const marker of [
    'new_is_glasgow',
    'glasgow_structural_changed',
    'NEW IS NOT DISTINCT FROM OLD',
    "'PLAYER_BOX_SCORE'::public.\"DataCapability\"",
    "'SUPER_SHOTS'::public.\"DataCapability\"",
  ]) {
    invariant(!evidence.queueFunctionDefinition.includes(marker),
      `repair migration is partially materialized: queue_match_invalidation() contains ${marker}`);
  }
  invariant(evidence.matchTriggerDefinitions.length === 1,
    'repair migration is partially materialized: Match lifecycle trigger is missing or duplicated');
  invariant(evidence.matchTriggerDefinitions[0]!.includes('"updatedAt"'),
    'repair migration is partially materialized: Match lifecycle trigger already has the repaired column list');
}

export function validatePreviewPrismaLedger(
  rows: readonly PreviewMigrationLedgerRow[],
  expectedPrefix: readonly MigrationDescriptor[],
  pendingMigrationName: string,
): PreviewLedgerValidation {
  if (rows.length === 0) {
    return {
      mode: 'empty',
      expectedPrefix: [...expectedPrefix],
      pendingMigrationName,
    };
  }

  invariant(rows.length === expectedPrefix.length,
    `reuse mode requires exactly ${expectedPrefix.length} existing Prisma ledger rows, found ${rows.length}`);
  const expectedNames = expectedPrefix.map((migration) => migration.migrationName);
  const actualNames = rows.map((migration) => migration.migrationName);
  invariant(new Set(actualNames).size === actualNames.length,
    'reuse mode Prisma ledger contains duplicate migration rows');
  invariant(JSON.stringify(actualNames) === JSON.stringify(expectedNames),
    'reuse mode Prisma ledger is not the exact contiguous checked-in prefix');
  invariant(!actualNames.includes(pendingMigrationName),
    `${pendingMigrationName} is not pending in reuse mode`);

  for (const [index, expected] of expectedPrefix.entries()) {
    const actual = rows[index]!;
    invariant(actual.checksum === expected.checksum,
      `${expected.migrationName} checksum does not match the checked-in SQL`);
    invariant(actual.finishedAt !== null,
      `${expected.migrationName} is unfinished`);
    invariant(actual.rolledBackAt === null,
      `${expected.migrationName} is rolled back`);
  }

  return {
    mode: 'reuse',
    expectedPrefix: [...expectedPrefix],
    pendingMigrationName,
  };
}
