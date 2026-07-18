import 'server-only';

import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  getAnalyticsDatabase,
  getStatsOperationsDatabase,
  scopedDatabaseConfiguration,
} from '@/lib/scoped-database-clients';

export type ScopedDatabaseBoundary = 'analytics' | 'statsOperations';

type ProbeClient = Pick<PrismaClient, '$queryRaw'>;

const DATABASE_TIMEOUT_MS = 3_000;
const HEALTHY_CACHE_TTL_MS = 60_000;
const UNHEALTHY_CACHE_TTL_MS = 5_000;
const SHARED_POOLER_HOST_PATTERN = /^aws-\d+-[a-z]{2}-[a-z]+-\d+\.pooler\.supabase\.com$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const REVIEWED_CONNECTION_PARAMETERS = new Set([
  'connect_timeout',
  'sslmode',
  'pgbouncer',
  'connection_limit',
  'pool_timeout',
]);

interface AnalyticsBoundaryRow {
  identity_ok: boolean;
  role_attributes_ok: boolean;
  no_role_memberships: boolean;
  schema_usage_ok: boolean;
  read_only_ok: boolean;
  exact_surface_ok: boolean;
  no_write_privileges: boolean;
  no_sequence_privileges: boolean;
  no_function_privileges: boolean;
  no_schema_create: boolean;
  statement_timeout_ok: boolean;
  statement_timeout_ms: number;
}

interface OperationsBoundaryRow {
  identity_ok: boolean;
  role_attributes_ok: boolean;
  no_role_memberships: boolean;
  schema_usage_ok: boolean;
  exact_function_surface_ok: boolean;
  no_relation_privileges: boolean;
  no_sequence_privileges: boolean;
  no_schema_create: boolean;
  statement_timeout_ok: boolean;
  statement_timeout_ms: number;
}

interface RoutingBoundary {
  configured: boolean;
  connectionUrlValid: boolean;
  connectionParametersOk: boolean;
  targetOk: boolean;
  hostOk: boolean;
  projectRefOk: boolean;
  urlRoleOk: boolean;
}

export interface AnalyticsBoundaryProbe extends RoutingBoundary {
  boundary: 'analytics';
  ok: boolean;
  latencyMs: number;
  identityOk: boolean;
  roleAttributesOk: boolean;
  noRoleMemberships: boolean;
  schemaUsageOk: boolean;
  readOnly: boolean;
  exactSurface: boolean;
  noWritePrivileges: boolean;
  noSequencePrivileges: boolean;
  noFunctionPrivileges: boolean;
  noSchemaCreate: boolean;
  statementTimeoutOk: boolean;
  statementTimeoutMs: number | null;
}

export interface OperationsBoundaryProbe extends RoutingBoundary {
  boundary: 'statsOperations';
  ok: boolean;
  latencyMs: number;
  identityOk: boolean;
  roleAttributesOk: boolean;
  noRoleMemberships: boolean;
  schemaUsageOk: boolean;
  exactFunctionSurface: boolean;
  noRelationPrivileges: boolean;
  noSequencePrivileges: boolean;
  noSchemaCreate: boolean;
  statementTimeoutOk: boolean;
  statementTimeoutMs: number | null;
}

export type ScopedDatabaseBoundaryProbe = AnalyticsBoundaryProbe | OperationsBoundaryProbe;

interface CacheEntry {
  fingerprint: string;
  expiresAt: number;
  promise: Promise<ScopedDatabaseBoundaryProbe>;
}

const boundaryCache = new Map<ScopedDatabaseBoundary, CacheEntry>();

function parsePostgresUrl(raw: string | undefined): URL | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = new URL(raw);
    return ['postgres:', 'postgresql:'].includes(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

function decodedUsername(url: URL): string | null {
  try {
    const username = decodeURIComponent(url.username).toLowerCase();
    return username && !username.includes('%') ? username : null;
  } catch {
    return null;
  }
}

function projectRefForRole(url: URL, expectedRole: string): string | null {
  const username = decodedUsername(url);
  if (!username) return null;
  const match = new RegExp(`^${expectedRole}\\.([a-z0-9]{20})$`).exec(username);
  return match?.[1] ?? null;
}

function routingBoundary(boundary: ScopedDatabaseBoundary): RoutingBoundary {
  const configuration = scopedDatabaseConfiguration();
  const variable = boundary === 'analytics'
    ? 'ANALYTICS_DATABASE_URL'
    : 'STATS_OPERATIONS_DATABASE_URL';
  const expectedRole = boundary === 'analytics'
    ? 'centrepass_analytics'
    : 'centrepass_stats_operations';
  const configured = boundary === 'analytics'
    ? configuration.analyticsDatabaseUrlConfigured
    : configuration.statsOperationsDatabaseUrlConfigured;
  const connectionUrlValid = boundary === 'analytics'
    ? configuration.analyticsDatabaseUrlValid
    : configuration.statsOperationsDatabaseUrlValid;
  const primary = parsePostgresUrl(process.env.DATABASE_URL);
  const scoped = parsePostgresUrl(process.env[variable]);

  if (!configured || !connectionUrlValid || !primary || !scoped) {
    return {
      configured,
      connectionUrlValid,
      connectionParametersOk: false,
      targetOk: false,
      hostOk: false,
      projectRefOk: false,
      urlRoleOk: false,
    };
  }

  const primaryHost = primary.hostname.toLowerCase();
  const scopedHost = scoped.hostname.toLowerCase();
  const hostOk = primaryHost === scopedHost
    && primary.port === scoped.port
    && primary.pathname === scoped.pathname;
  const primaryProjectRef = projectRefForRole(primary, 'postgres');
  const scopedProjectRef = projectRefForRole(scoped, expectedRole);
  const sharedPooler = SHARED_POOLER_HOST_PATTERN.test(scopedHost);
  const local = LOCAL_HOSTS.has(scopedHost) && LOCAL_HOSTS.has(primaryHost);
  const expectedConnectionLimit = boundary === 'analytics' ? '5' : '2';
  const connectTimeout = scoped.searchParams.get('connect_timeout');
  const connectTimeoutOk = connectTimeout === null
    || (/^[1-9][0-9]*$/.test(connectTimeout) && Number(connectTimeout) <= 30);
  const reviewedParametersOnly = [...scoped.searchParams.keys()].every(
    (key) => REVIEWED_CONNECTION_PARAMETERS.has(key)
      && scoped.searchParams.getAll(key).length === 1,
  );
  const connectionParametersOk = sharedPooler
    ? Boolean(scoped.password)
      && !scoped.hash
      && scoped.pathname === '/postgres'
      && scoped.port === '6543'
      && reviewedParametersOnly
      && connectTimeoutOk
      && scoped.searchParams.getAll('sslmode').length === 1
      && scoped.searchParams.get('sslmode')?.toLowerCase() === 'verify-full'
      && scoped.searchParams.getAll('pgbouncer').length === 1
      && scoped.searchParams.get('pgbouncer') === 'true'
      && scoped.searchParams.getAll('connection_limit').length === 1
      && scoped.searchParams.get('connection_limit') === expectedConnectionLimit
      && scoped.searchParams.getAll('pool_timeout').length === 1
      && scoped.searchParams.get('pool_timeout') === '5'
    : local && process.env.NODE_ENV !== 'production';
  const urlRoleOk = sharedPooler
    ? scopedProjectRef !== null
    : local && decodedUsername(scoped) === expectedRole;
  const projectRefOk = sharedPooler
    ? primaryProjectRef !== null
      && scopedProjectRef !== null
      && primaryProjectRef === scopedProjectRef
    : local;
  const approvedEndpoint = sharedPooler || (process.env.NODE_ENV !== 'production' && local);

  return {
    configured,
    connectionUrlValid,
    connectionParametersOk,
    targetOk: approvedEndpoint
      && hostOk
      && projectRefOk
      && urlRoleOk
      && connectionParametersOk,
    hostOk,
    projectRefOk,
    urlRoleOk,
  };
}

function configurationFingerprint(boundary: ScopedDatabaseBoundary): string {
  const variable = boundary === 'analytics'
    ? 'ANALYTICS_DATABASE_URL'
    : 'STATS_OPERATIONS_DATABASE_URL';
  return createHash('sha256')
    .update(JSON.stringify([
      boundary,
      process.env.NODE_ENV ?? '',
      process.env.DATABASE_URL ?? '',
      process.env[variable] ?? '',
    ]))
    .digest('hex');
}

async function runProbeQuery<Row>(client: ProbeClient, query: Prisma.Sql) {
  const startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const rows = await Promise.race([
      client.$queryRaw<Row[]>(query),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Scoped database boundary probe timed out')),
          DATABASE_TIMEOUT_MS,
        );
      }),
    ]);
    return { rows, latencyMs: Date.now() - startedAt };
  } catch {
    return { rows: null, latencyMs: Date.now() - startedAt };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function emptyAnalyticsProbe(routing: RoutingBoundary, latencyMs = 0): AnalyticsBoundaryProbe {
  return {
    boundary: 'analytics',
    ok: false,
    latencyMs,
    ...routing,
    identityOk: false,
    roleAttributesOk: false,
    noRoleMemberships: false,
    schemaUsageOk: false,
    readOnly: false,
    exactSurface: false,
    noWritePrivileges: false,
    noSequencePrivileges: false,
    noFunctionPrivileges: false,
    noSchemaCreate: false,
    statementTimeoutOk: false,
    statementTimeoutMs: null,
  };
}

function emptyOperationsProbe(routing: RoutingBoundary, latencyMs = 0): OperationsBoundaryProbe {
  return {
    boundary: 'statsOperations',
    ok: false,
    latencyMs,
    ...routing,
    identityOk: false,
    roleAttributesOk: false,
    noRoleMemberships: false,
    schemaUsageOk: false,
    exactFunctionSurface: false,
    noRelationPrivileges: false,
    noSequencePrivileges: false,
    noSchemaCreate: false,
    statementTimeoutOk: false,
    statementTimeoutMs: null,
  };
}

function failedProbe(boundary: ScopedDatabaseBoundary): ScopedDatabaseBoundaryProbe {
  const routing: RoutingBoundary = {
    configured: false,
    connectionUrlValid: false,
    connectionParametersOk: false,
    targetOk: false,
    hostOk: false,
    projectRefOk: false,
    urlRoleOk: false,
  };
  return boundary === 'analytics'
    ? emptyAnalyticsProbe(routing)
    : emptyOperationsProbe(routing);
}

async function uncachedAnalyticsProbe(): Promise<AnalyticsBoundaryProbe> {
  const routing = routingBoundary('analytics');
  if (!routing.targetOk) return emptyAnalyticsProbe(routing);
  const result = await runProbeQuery<AnalyticsBoundaryRow>(getAnalyticsDatabase(), Prisma.sql`
    WITH allowed(schema_name, relation_name) AS (
      VALUES
        ('analytics', 'competition_directory'),
        ('analytics', 'player_match_read'),
        ('analytics', 'team_match_read'),
        ('analytics', 'player_directory'),
        ('analytics', 'team_directory'),
        ('analytics', 'player_alias_directory'),
        ('analytics', 'team_alias_directory'),
        ('analytics', 'stage_directory'),
        ('analytics', 'stage_group_directory'),
        ('analytics', 'player_edition_directory'),
        ('analytics', 'team_edition_directory'),
        ('analytics', 'team_power_match'),
        ('analytics', 'opponent_match_directory'),
        ('analytics', 'cache_revision_read')
    ),
    relation_access AS (
      SELECT namespace.nspname AS schema_name, relation.relname AS relation_name,
        has_table_privilege(CURRENT_USER, relation.oid, 'SELECT') AS can_select,
        has_table_privilege(CURRENT_USER, relation.oid, 'INSERT')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'UPDATE')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'DELETE')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'TRUNCATE')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'TRIGGER')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'REFERENCES') AS can_write
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp%'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
    ),
    sequence_access AS (
      SELECT has_sequence_privilege(CURRENT_USER, relation.oid, 'USAGE')
        OR has_sequence_privilege(CURRENT_USER, relation.oid, 'SELECT')
        OR has_sequence_privilege(CURRENT_USER, relation.oid, 'UPDATE') AS can_access
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp%'
        AND relation.relkind = 'S'
    )
    SELECT
      CURRENT_USER = 'centrepass_analytics' AS identity_ok,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles role
        WHERE role.rolname = CURRENT_USER AND role.rolcanlogin
          AND NOT role.rolsuper AND NOT role.rolinherit
          AND NOT role.rolcreaterole AND NOT role.rolcreatedb
          AND NOT role.rolreplication AND NOT role.rolbypassrls
      ) AS role_attributes_ok,
      NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members membership
        JOIN pg_catalog.pg_roles member ON member.oid = membership.member
        WHERE member.rolname = CURRENT_USER
      ) AS no_role_memberships,
      has_schema_privilege(CURRENT_USER, 'analytics', 'USAGE') AS schema_usage_ok,
      current_setting('default_transaction_read_only', true) = 'on' AS read_only_ok,
      NOT EXISTS (
        SELECT 1 FROM allowed
        WHERE NOT has_table_privilege(
          CURRENT_USER,
          pg_catalog.format('%I.%I', allowed.schema_name, allowed.relation_name),
          'SELECT'
        )
      ) AND NOT EXISTS (
        SELECT 1 FROM relation_access access
        WHERE access.can_select
          AND NOT EXISTS (
            SELECT 1 FROM allowed
            WHERE allowed.schema_name = access.schema_name
              AND allowed.relation_name = access.relation_name
          )
          AND NOT (
            access.schema_name = 'extensions'
            AND access.relation_name IN ('pg_stat_statements', 'pg_stat_statements_info')
          )
      ) AS exact_surface_ok,
      NOT EXISTS (SELECT 1 FROM relation_access access WHERE access.can_write)
        AS no_write_privileges,
      NOT EXISTS (SELECT 1 FROM sequence_access access WHERE access.can_access)
        AS no_sequence_privileges,
      NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc routine
        JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
        WHERE namespace.nspname IN ('public', 'analytics')
          AND has_function_privilege(CURRENT_USER, routine.oid, 'EXECUTE')
      ) AS no_function_privileges,
      NOT has_schema_privilege(CURRENT_USER, 'public', 'CREATE')
        AND NOT has_schema_privilege(CURRENT_USER, 'analytics', 'CREATE') AS no_schema_create,
      current_setting('statement_timeout')::INTERVAL > INTERVAL '0 seconds'
        AND current_setting('statement_timeout')::INTERVAL <= INTERVAL '2 seconds'
        AS statement_timeout_ok,
      (EXTRACT(EPOCH FROM current_setting('statement_timeout')::INTERVAL) * 1000)::INTEGER
        AS statement_timeout_ms
  `);
  const row = result.rows?.[0];
  if (!row) return emptyAnalyticsProbe(routing, result.latencyMs);
  const probe: AnalyticsBoundaryProbe = {
    boundary: 'analytics',
    latencyMs: result.latencyMs,
    ...routing,
    identityOk: row.identity_ok === true,
    roleAttributesOk: row.role_attributes_ok === true,
    noRoleMemberships: row.no_role_memberships === true,
    schemaUsageOk: row.schema_usage_ok === true,
    readOnly: row.read_only_ok === true,
    exactSurface: row.exact_surface_ok === true,
    noWritePrivileges: row.no_write_privileges === true,
    noSequencePrivileges: row.no_sequence_privileges === true,
    noFunctionPrivileges: row.no_function_privileges === true,
    noSchemaCreate: row.no_schema_create === true,
    statementTimeoutOk: row.statement_timeout_ok === true,
    statementTimeoutMs: row.statement_timeout_ms ?? null,
    ok: false,
  };
  probe.ok = probe.targetOk
    && probe.identityOk
    && probe.roleAttributesOk
    && probe.noRoleMemberships
    && probe.schemaUsageOk
    && probe.readOnly
    && probe.exactSurface
    && probe.noWritePrivileges
    && probe.noSequencePrivileges
    && probe.noFunctionPrivileges
    && probe.noSchemaCreate
    && probe.statementTimeoutOk;
  return probe;
}

async function uncachedOperationsProbe(): Promise<OperationsBoundaryProbe> {
  const routing = routingBoundary('statsOperations');
  if (!routing.targetOk) return emptyOperationsProbe(routing);
  const result = await runProbeQuery<OperationsBoundaryRow>(getStatsOperationsDatabase(), Prisma.sql`
    WITH relation_access AS (
      SELECT namespace.nspname AS schema_name, relation.relname AS relation_name,
        has_table_privilege(CURRENT_USER, relation.oid, 'SELECT') AS can_select,
        has_table_privilege(CURRENT_USER, relation.oid, 'INSERT')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'UPDATE')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'DELETE')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'TRUNCATE')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'TRIGGER')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'REFERENCES') AS can_write
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp%'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
    ),
    sequence_access AS (
      SELECT has_sequence_privilege(CURRENT_USER, relation.oid, 'USAGE')
        OR has_sequence_privilege(CURRENT_USER, relation.oid, 'SELECT')
        OR has_sequence_privilege(CURRENT_USER, relation.oid, 'UPDATE') AS can_access
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp%'
        AND relation.relkind = 'S'
    )
    SELECT
      CURRENT_USER = 'centrepass_stats_operations' AS identity_ok,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles role
        WHERE role.rolname = CURRENT_USER AND role.rolcanlogin
          AND NOT role.rolsuper AND NOT role.rolinherit
          AND NOT role.rolcreaterole AND NOT role.rolcreatedb
          AND NOT role.rolreplication AND NOT role.rolbypassrls
      ) AS role_attributes_ok,
      NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members membership
        JOIN pg_catalog.pg_roles member ON member.oid = membership.member
        WHERE member.rolname = CURRENT_USER
      ) AS no_role_memberships,
      has_schema_privilege(CURRENT_USER, 'analytics', 'USAGE') AS schema_usage_ok,
      has_function_privilege(
        CURRENT_USER,
        'analytics.reserve_stat_query_rate_limit(text)',
        'EXECUTE'
      ) AND has_function_privilege(
        CURRENT_USER,
        'analytics.write_stat_query_telemetry(text,jsonb,text,text,integer,integer,text)',
        'EXECUTE'
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc routine
        JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
        WHERE namespace.nspname IN ('public', 'analytics')
          AND has_function_privilege(CURRENT_USER, routine.oid, 'EXECUTE')
          AND routine.oid NOT IN (
            'analytics.reserve_stat_query_rate_limit(text)'::regprocedure,
            'analytics.write_stat_query_telemetry(text,jsonb,text,text,integer,integer,text)'::regprocedure
          )
      ) AS exact_function_surface_ok,
      NOT EXISTS (
        SELECT 1 FROM relation_access access
        WHERE access.can_write OR (
          access.can_select AND NOT (
            access.schema_name = 'extensions'
            AND access.relation_name IN ('pg_stat_statements', 'pg_stat_statements_info')
          )
        )
      ) AS no_relation_privileges,
      NOT EXISTS (SELECT 1 FROM sequence_access access WHERE access.can_access)
        AS no_sequence_privileges,
      NOT has_schema_privilege(CURRENT_USER, 'public', 'CREATE')
        AND NOT has_schema_privilege(CURRENT_USER, 'analytics', 'CREATE') AS no_schema_create,
      current_setting('statement_timeout')::INTERVAL > INTERVAL '0 seconds'
        AND current_setting('statement_timeout')::INTERVAL <= INTERVAL '2 seconds'
        AS statement_timeout_ok,
      (EXTRACT(EPOCH FROM current_setting('statement_timeout')::INTERVAL) * 1000)::INTEGER
        AS statement_timeout_ms
  `);
  const row = result.rows?.[0];
  if (!row) return emptyOperationsProbe(routing, result.latencyMs);
  const probe: OperationsBoundaryProbe = {
    boundary: 'statsOperations',
    latencyMs: result.latencyMs,
    ...routing,
    identityOk: row.identity_ok === true,
    roleAttributesOk: row.role_attributes_ok === true,
    noRoleMemberships: row.no_role_memberships === true,
    schemaUsageOk: row.schema_usage_ok === true,
    exactFunctionSurface: row.exact_function_surface_ok === true,
    noRelationPrivileges: row.no_relation_privileges === true,
    noSequencePrivileges: row.no_sequence_privileges === true,
    noSchemaCreate: row.no_schema_create === true,
    statementTimeoutOk: row.statement_timeout_ok === true,
    statementTimeoutMs: row.statement_timeout_ms ?? null,
    ok: false,
  };
  probe.ok = probe.targetOk
    && probe.identityOk
    && probe.roleAttributesOk
    && probe.noRoleMemberships
    && probe.schemaUsageOk
    && probe.exactFunctionSurface
    && probe.noRelationPrivileges
    && probe.noSequencePrivileges
    && probe.noSchemaCreate
    && probe.statementTimeoutOk;
  return probe;
}

async function cachedProbe(
  boundary: ScopedDatabaseBoundary,
  forceRefresh: boolean,
): Promise<ScopedDatabaseBoundaryProbe> {
  const fingerprint = configurationFingerprint(boundary);
  const now = Date.now();
  const cached = boundaryCache.get(boundary);
  if (!forceRefresh && cached && cached.fingerprint === fingerprint && cached.expiresAt > now) {
    return cached.promise;
  }

  const run = async (): Promise<ScopedDatabaseBoundaryProbe> => boundary === 'analytics'
    ? uncachedAnalyticsProbe()
    : uncachedOperationsProbe();
  const promise = run().catch(() => failedProbe(boundary));
  const entry: CacheEntry = {
    fingerprint,
    expiresAt: now + UNHEALTHY_CACHE_TTL_MS,
    promise,
  };
  boundaryCache.set(boundary, entry);
  void promise.then((result) => {
    if (boundaryCache.get(boundary) === entry) {
      entry.expiresAt = Date.now() + (result.ok ? HEALTHY_CACHE_TTL_MS : UNHEALTHY_CACHE_TTL_MS);
    }
  });
  return promise;
}

export function probeAnalyticsDatabaseBoundary(
  options: { forceRefresh?: boolean } = {},
): Promise<AnalyticsBoundaryProbe> {
  return cachedProbe('analytics', options.forceRefresh === true) as Promise<AnalyticsBoundaryProbe>;
}

export function probeStatsOperationsDatabaseBoundary(
  options: { forceRefresh?: boolean } = {},
): Promise<OperationsBoundaryProbe> {
  return cachedProbe(
    'statsOperations',
    options.forceRefresh === true,
  ) as Promise<OperationsBoundaryProbe>;
}

export function invalidateScopedDatabaseBoundaryCache(
  boundary?: ScopedDatabaseBoundary,
): void {
  if (boundary) boundaryCache.delete(boundary);
  else boundaryCache.clear();
}

export class ScopedDatabaseBoundaryError extends Error {
  constructor(public readonly boundary: ScopedDatabaseBoundary) {
    super(`The ${boundary} database boundary is unavailable`);
    this.name = 'ScopedDatabaseBoundaryError';
  }
}

export async function assertAnalyticsDatabaseBoundary(): Promise<void> {
  if (!(await probeAnalyticsDatabaseBoundary()).ok) {
    throw new ScopedDatabaseBoundaryError('analytics');
  }
}

export async function assertStatsOperationsDatabaseBoundary(): Promise<void> {
  if (!(await probeStatsOperationsDatabaseBoundary()).ok) {
    throw new ScopedDatabaseBoundaryError('statsOperations');
  }
}

export async function getVerifiedAnalyticsDatabase(): Promise<PrismaClient> {
  await assertAnalyticsDatabaseBoundary();
  return getAnalyticsDatabase();
}

export async function getVerifiedStatsOperationsDatabase(): Promise<PrismaClient> {
  await assertStatsOperationsDatabaseBoundary();
  return getStatsOperationsDatabase();
}
