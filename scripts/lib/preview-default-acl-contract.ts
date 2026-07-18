import { Prisma } from '@prisma/client';

export const DATA_API_DEFAULT_ACL_GRANTEES = [
  'PUBLIC',
  'anon',
  'authenticated',
  'service_role',
] as const;

export interface DefaultAclPrivilegeRow {
  owner: string;
  namespaceOid: bigint;
  schema: string | null;
  objectType: string;
  grantee: string;
  privilege: string;
}

export interface ProviderDefaultAclRow {
  scope: string;
  objectType: string;
  grantee: string;
  privileges: string[];
}

interface VerifyDefaultAclOptions {
  grantees: readonly string[];
  providerOwnedApplicationObjects: bigint;
}

const DATA_API_OBJECT_TYPES = new Set(['TABLES', 'SEQUENCES', 'FUNCTIONS']);

export const defaultAclInspectionQuery = Prisma.sql`
  SELECT owner.rolname AS owner,
    defaults.defaclnamespace::bigint AS "namespaceOid",
    namespace.nspname AS schema,
    CASE defaults.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES'
      WHEN 'f' THEN 'FUNCTIONS' ELSE defaults.defaclobjtype::text END AS "objectType",
    COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
    privilege.privilege_type AS privilege
  FROM pg_default_acl defaults
  JOIN pg_roles owner ON owner.oid = defaults.defaclrole
  LEFT JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
  CROSS JOIN LATERAL aclexplode(defaults.defaclacl) privilege
  LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
  WHERE defaults.defaclnamespace = 0
    OR namespace.nspname IN ('public', 'analytics')
    OR (defaults.defaclnamespace <> 0 AND namespace.oid IS NULL)
  ORDER BY owner.rolname, defaults.defaclnamespace, "objectType", grantee, privilege.privilege_type`;

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
  return `${row.owner}:${scopeOf(row)}:${row.objectType}:${row.grantee}:${row.privilege}`;
}

export function verifyDefaultAclBoundary(
  rows: DefaultAclPrivilegeRow[],
  options: VerifyDefaultAclOptions,
): ProviderDefaultAclRow[] {
  const reviewedGrantees = new Set(options.grantees);
  const relevant = rows.filter((row) => {
    scopeOf(row);
    return DATA_API_OBJECT_TYPES.has(row.objectType) && reviewedGrantees.has(row.grantee);
  });
  const unsupported = relevant.filter((row) =>
    row.owner !== 'supabase_admin');
  if (unsupported.length > 0) {
    throw new Error(`unsafe future-object default ACL grants: ${unsupported.map(describe).join(', ')}`);
  }

  const providerManaged = relevant.filter((row) => row.owner === 'supabase_admin');
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
      privileges: [],
    };
    group.privileges.push(row.privilege);
    grouped.set(key, group);
  }
  return [...grouped.values()]
    .map((row) => ({ ...row, privileges: row.privileges.toSorted() }))
    .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
