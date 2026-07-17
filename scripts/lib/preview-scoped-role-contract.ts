export const ANALYTICS_ROLE = 'centrepass_analytics' as const;
export const OPERATIONS_ROLE = 'centrepass_stats_operations' as const;

export const ANALYTICS_VIEW_ALLOWLIST = [
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

export const OPERATIONS_FUNCTION_ALLOWLIST = [
  'analytics.reserve_stat_query_rate_limit(text)',
  'analytics.write_stat_query_telemetry(text,jsonb,text,text,integer,integer,text)',
] as const;

export interface ScopedRoleRow {
  roleName: string;
  canLogin: boolean;
  inherit: boolean;
  superuser: boolean;
  createRole: boolean;
  createDatabase: boolean;
  replication: boolean;
  bypassRls: boolean;
  memberOfCount: bigint;
  databaseConnect: boolean;
  roleSettings: string[];
}

export interface RoleMembershipRow {
  grantedRole: string;
  memberRole: string;
  adminOption: boolean;
  inheritOption: boolean;
  setOption: boolean;
  grantorRole: string;
}

export interface RoleSettingRow {
  roleName: string;
  setting: string;
}

export interface SchemaPrivilegeRow {
  roleName: string;
  schemaName: string;
  privilege: string;
}

export interface RelationObjectRow {
  schemaName: string;
  relationName: string;
  relationKind: string;
  owner: string;
}

export interface RelationPrivilegeRow extends RelationObjectRow {
  roleName: string;
  privilege: string;
}

export interface FunctionObjectRow {
  signature: string;
  owner: string;
  securityDefiner: boolean;
  searchPath: string | null;
}

export interface FunctionPrivilegeRow extends FunctionObjectRow {
  roleName: string;
  privilege: string;
}

export interface PreviewScopedRoleCatalogState {
  roles: ScopedRoleRow[];
  memberships: RoleMembershipRow[];
  settings: RoleSettingRow[];
  schemaPrivileges: SchemaPrivilegeRow[];
  relationObjects: RelationObjectRow[];
  relationPrivileges: RelationPrivilegeRow[];
  sequencePrivileges: RelationPrivilegeRow[];
  functionObjects: FunctionObjectRow[];
  functionPrivileges: FunctionPrivilegeRow[];
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Preview scoped-role verification failed: ${message}`);
}

function exactSet(actual: string[], expected: string[], label: string) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  invariant(actualSet.size === actual.length, `${label} contains duplicates`);
  invariant(expectedSet.size === expected.length, `${label} contract contains duplicates`);
  const missing = expected.filter((value) => !actualSet.has(value));
  const extra = actual.filter((value) => !expectedSet.has(value));
  invariant(missing.length === 0 && extra.length === 0,
    `${label} differs; missing=[${missing.join(',')}], extra=[${extra.join(',')}]`);
}

function roleKey(row: { roleName: string }) {
  return row.roleName;
}

function membershipKey(row: RoleMembershipRow) {
  return [
    row.grantedRole,
    row.memberRole,
    row.adminOption,
    row.inheritOption,
    row.setOption,
    row.grantorRole,
  ].join('|');
}

function settingKey(row: RoleSettingRow) {
  return `${row.roleName}|${row.setting}`;
}

function schemaPrivilegeKey(row: SchemaPrivilegeRow) {
  return `${row.roleName}|${row.schemaName}|${row.privilege}`;
}

function relationPrivilegeKey(row: RelationPrivilegeRow) {
  return `${row.roleName}|${row.schemaName}.${row.relationName}|${row.privilege}`;
}

function functionPrivilegeKey(row: FunctionPrivilegeRow) {
  return `${row.roleName}|${row.signature}|${row.privilege}`;
}

/**
 * Verifies the effective preview privileges, not merely the explicit ACL rows.
 * This catches grants inherited through PUBLIC or role memberships as well as
 * missing required grants and drift in the reviewed object allowlists.
 */
export function verifyPreviewScopedRoleContract(
  state: PreviewScopedRoleCatalogState,
  options: { supabasePreview?: boolean } = {},
) {
  exactSet(state.roles.map(roleKey), [ANALYTICS_ROLE, OPERATIONS_ROLE], 'roles');
  for (const role of state.roles) {
    invariant(role.canLogin, `${role.roleName} cannot login`);
    invariant(!role.inherit, `${role.roleName} unexpectedly inherits privileges`);
    invariant(!role.superuser, `${role.roleName} is a superuser`);
    invariant(!role.createRole, `${role.roleName} can create roles`);
    invariant(!role.createDatabase, `${role.roleName} can create databases`);
    invariant(!role.replication, `${role.roleName} has replication privileges`);
    invariant(!role.bypassRls, `${role.roleName} bypasses RLS`);
    invariant(role.memberOfCount === BigInt(0), `${role.roleName} is a member of another role`);
    invariant(role.databaseConnect, `${role.roleName} cannot connect to the preview database`);
    invariant(role.roleSettings.length === 0,
      `${role.roleName} has unexpected cluster-wide role settings`);
  }

  exactSet(state.memberships.map(membershipKey), options.supabasePreview ? [
    `${ANALYTICS_ROLE}|postgres|true|false|false|supabase_admin`,
    `${OPERATIONS_ROLE}|postgres|true|false|false|supabase_admin`,
  ] : [], 'provider-managed administrative memberships');

  exactSet(state.settings.map(settingKey), [
    `${ANALYTICS_ROLE}|default_transaction_read_only=on`,
    `${ANALYTICS_ROLE}|search_path=analytics`,
    `${ANALYTICS_ROLE}|statement_timeout=2s`,
    `${OPERATIONS_ROLE}|search_path=""`,
    `${OPERATIONS_ROLE}|statement_timeout=2s`,
  ], 'database role settings');

  exactSet(state.schemaPrivileges.map(schemaPrivilegeKey), [
    `${ANALYTICS_ROLE}|analytics|USAGE`,
    `${OPERATIONS_ROLE}|analytics|USAGE`,
  ], 'application schema privileges');

  const relationByName = new Map(
    state.relationObjects.map((object) => [`${object.schemaName}.${object.relationName}`, object]),
  );
  for (const view of ANALYTICS_VIEW_ALLOWLIST) {
    const object = relationByName.get(`analytics.${view}`);
    invariant(object, `reviewed analytics view analytics.${view} is missing`);
    invariant(object.relationKind === 'v', `analytics.${view} is not a plain view`);
    invariant(object.owner === 'postgres', `analytics.${view} is not postgres-owned`);
  }
  exactSet(state.relationPrivileges.map(relationPrivilegeKey),
    ANALYTICS_VIEW_ALLOWLIST.map((view) => `${ANALYTICS_ROLE}|analytics.${view}|SELECT`),
    'effective relation privileges');
  exactSet(state.sequencePrivileges.map(relationPrivilegeKey), [],
    'effective sequence privileges');

  const functionBySignature = new Map(
    state.functionObjects.map((object) => [object.signature, object]),
  );
  for (const signature of OPERATIONS_FUNCTION_ALLOWLIST) {
    const object = functionBySignature.get(signature);
    invariant(object, `reviewed operations function ${signature} is missing`);
    invariant(object.owner === 'postgres', `${signature} is not postgres-owned`);
    invariant(object.securityDefiner, `${signature} is not SECURITY DEFINER`);
    invariant(object.searchPath === '""', `${signature} does not use an empty search_path`);
  }
  exactSet(state.functionPrivileges.map(functionPrivilegeKey),
    OPERATIONS_FUNCTION_ALLOWLIST.map((signature) =>
      `${OPERATIONS_ROLE}|${signature}|EXECUTE`),
    'effective function privileges');

  return {
    analyticsViews: ANALYTICS_VIEW_ALLOWLIST.length,
    operationsFunctions: OPERATIONS_FUNCTION_ALLOWLIST.length,
  };
}
