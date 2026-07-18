import { Prisma } from '@prisma/client';

export const DATA_API_DEFAULT_ACL_GRANTEES = [
  'PUBLIC',
  'anon',
  'authenticated',
  'service_role',
] as const;

export interface DefaultAclPrivilegeRow {
  ownerOid: bigint;
  ownerName: string | null;
  namespaceOid: bigint;
  schema: string | null;
  objectTypeCode: string;
  objectType: string;
  grantee: string;
  privilege: string;
  grantable: boolean;
}

export interface ProviderDefaultAclRow {
  scope: string;
  objectType: string;
  grantee: string;
  grantable: false;
  privileges: string[];
}

interface VerifyDefaultAclOptions {
  grantees: readonly string[];
  providerOwnedApplicationObjects: bigint;
}

interface DefaultAclObjectTypePolicy {
  label: string;
  privileges: ReadonlySet<string>;
  providerExceptionEligible: boolean;
}

/**
 * PostgreSQL 17 documents r/S/f/T/n in pg_default_acl. L is retained as an
 * explicit deny-only defensive policy for large-object ACLs: PG17 cannot
 * create such a default today, but it must not become an accidental provider
 * exception if a provider extension or future server ever emits it.
 */
const DEFAULT_ACL_OBJECT_TYPE_POLICIES = new Map<string, DefaultAclObjectTypePolicy>([
  ['r', {
    label: 'TABLES',
    privileges: new Set([
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN',
    ]),
    providerExceptionEligible: true,
  }],
  ['S', {
    label: 'SEQUENCES',
    privileges: new Set(['USAGE', 'SELECT', 'UPDATE']),
    providerExceptionEligible: true,
  }],
  ['f', {
    label: 'FUNCTIONS',
    privileges: new Set(['EXECUTE']),
    providerExceptionEligible: true,
  }],
  ['T', {
    label: 'TYPES',
    privileges: new Set(['USAGE']),
    providerExceptionEligible: false,
  }],
  ['n', {
    label: 'SCHEMAS',
    privileges: new Set(['USAGE', 'CREATE']),
    providerExceptionEligible: false,
  }],
  ['L', {
    label: 'LARGE OBJECTS',
    privileges: new Set(['SELECT', 'UPDATE']),
    providerExceptionEligible: false,
  }],
]);

/**
 * PostgreSQL relation kinds governed by ALTER DEFAULT PRIVILEGES ... ON TABLES.
 * Foreign tables (`f`) are deliberately application objects here: excluding
 * them would let both current ACLs and provider ownership escape the boundary.
 */
export const APPLICATION_RELATION_KINDS = ['r', 'p', 'v', 'm', 'S', 'f'] as const;
export const APPLICATION_RELATION_KINDS_SQL = Prisma.raw(
  APPLICATION_RELATION_KINDS.map((kind) => `'${kind}'`).join(', '),
);

export const defaultAclInspectionQuery = Prisma.sql`
  SELECT defaults.defaclrole::bigint AS "ownerOid",
    owner.rolname AS "ownerName",
    defaults.defaclnamespace::bigint AS "namespaceOid",
    namespace.nspname AS schema,
    defaults.defaclobjtype::text AS "objectTypeCode",
    CASE defaults.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES'
      WHEN 'f' THEN 'FUNCTIONS' WHEN 'T' THEN 'TYPES' WHEN 'n' THEN 'SCHEMAS'
      WHEN 'L' THEN 'LARGE OBJECTS'
      ELSE 'UNKNOWN (' || defaults.defaclobjtype::text || ')' END AS "objectType",
    COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
    privilege.privilege_type AS privilege,
    privilege.is_grantable AS grantable
  FROM pg_default_acl defaults
  LEFT JOIN pg_roles owner ON owner.oid = defaults.defaclrole
  LEFT JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
  CROSS JOIN LATERAL aclexplode(defaults.defaclacl) privilege
  LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
  WHERE defaults.defaclnamespace = 0
    OR namespace.nspname IN ('public', 'analytics')
    OR (defaults.defaclnamespace <> 0 AND namespace.oid IS NULL)
  ORDER BY defaults.defaclrole, defaults.defaclnamespace,
    "objectType", grantee, privilege.privilege_type`;

function scopeOf(row: DefaultAclPrivilegeRow): string {
  if (row.namespaceOid === BigInt(0)) {
    if (row.schema !== null) {
      throw new Error('global default ACL unexpectedly resolved to a schema');
    }
    return 'GLOBAL';
  }
  if (row.schema !== 'public' && row.schema !== 'analytics') {
    throw new Error(
      `default ACL namespace ${row.namespaceOid} is missing or outside the reviewed schemas`,
    );
  }
  return row.schema;
}

function describe(row: DefaultAclPrivilegeRow): string {
  const owner = row.ownerName ?? `UNRESOLVED_OWNER_OID_${row.ownerOid}`;
  return `${owner}:${scopeOf(row)}:${row.objectType}:${row.grantee}:${row.privilege}${
    row.grantable ? ':WITH GRANT OPTION' : ''}`;
}

export function verifyNoCurrentDataApiGrants(counts: {
  relationGrants: bigint;
  functionGrants: bigint;
}): void {
  if (counts.relationGrants !== BigInt(0)) {
    throw new Error(
      `found ${counts.relationGrants} effective current relation, foreign-table, or sequence grants`,
    );
  }
  if (counts.functionGrants !== BigInt(0)) {
    throw new Error(`found ${counts.functionGrants} effective current function grants`);
  }
}

export function verifyDefaultAclBoundary(
  rows: DefaultAclPrivilegeRow[],
  options: VerifyDefaultAclOptions,
): ProviderDefaultAclRow[] {
  const reviewedGrantees = new Set(options.grantees);
  for (const row of rows) {
    scopeOf(row);
    if (row.ownerName === null) {
      throw new Error(`default ACL owner OID ${row.ownerOid} cannot be resolved`);
    }
  }
  const relevant = rows.filter((row) => reviewedGrantees.has(row.grantee));
  const invalidMatrixRows = relevant.filter((row) => {
    const policy = DEFAULT_ACL_OBJECT_TYPE_POLICIES.get(row.objectTypeCode);
    return !policy || policy.label !== row.objectType || !policy.privileges.has(row.privilege);
  });
  if (invalidMatrixRows.length > 0) {
    throw new Error(
      `unsupported default ACL object/privilege combinations: ${
        invalidMatrixRows.map(describe).join(', ')}`,
    );
  }
  const deniedObjectTypes = relevant.filter((row) =>
    !DEFAULT_ACL_OBJECT_TYPE_POLICIES.get(row.objectTypeCode)?.providerExceptionEligible);
  if (deniedObjectTypes.length > 0) {
    throw new Error(
      `default ACL object types outside the provider exception: ${
        deniedObjectTypes.map(describe).join(', ')}`,
    );
  }
  const unsupported = relevant.filter((row) =>
    row.ownerName !== 'supabase_admin');
  if (unsupported.length > 0) {
    throw new Error(`unsafe future-object default ACL grants: ${unsupported.map(describe).join(', ')}`);
  }

  const providerManaged = relevant.filter((row) => row.ownerName === 'supabase_admin');
  const grantableProviderDefaults = providerManaged.filter((row) => row.grantable);
  if (grantableProviderDefaults.length > 0) {
    throw new Error(
      `provider-managed default ACL grants must not be grantable: ${
        grantableProviderDefaults.map(describe).join(', ')}`,
    );
  }
  if (providerManaged.length > 0 && options.providerOwnedApplicationObjects !== BigInt(0)) {
    throw new Error(
      'supabase_admin default ACLs are unsafe while provider-owned application objects exist',
    );
  }

  const grouped = new Map<string, ProviderDefaultAclRow>();
  for (const row of providerManaged) {
    const scope = scopeOf(row);
    const key = JSON.stringify([scope, row.objectType, row.grantee]);
    const group = grouped.get(key) ?? {
      scope,
      objectType: row.objectType,
      grantee: row.grantee,
      grantable: false as const,
      privileges: [],
    };
    group.privileges.push(row.privilege);
    grouped.set(key, group);
  }
  return [...grouped.values()]
    .map((row) => ({ ...row, privileges: row.privileges.toSorted() }))
    .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
