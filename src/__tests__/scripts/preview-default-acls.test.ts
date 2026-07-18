import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPLICATION_RELATION_KINDS,
  type DefaultAclPrivilegeRow,
  defaultAclInspectionQuery,
  verifyDefaultAclBoundary,
  verifyNoCurrentDataApiGrants,
} from '../../../scripts/lib/preview-default-acl-contract';

function row(overrides: Partial<DefaultAclPrivilegeRow> = {}): DefaultAclPrivilegeRow {
  const value: DefaultAclPrivilegeRow = {
    ownerOid: BigInt(10),
    ownerName: 'postgres',
    namespaceOid: BigInt(0),
    schema: null,
    objectTypeCode: 'r',
    objectType: 'TABLES',
    grantee: 'anon',
    privilege: 'SELECT',
    grantable: false,
    ...overrides,
  };
  if (overrides.objectType && overrides.objectTypeCode === undefined) {
    value.objectTypeCode = ({
      TABLES: 'r',
      SEQUENCES: 'S',
      FUNCTIONS: 'f',
      TYPES: 'T',
      SCHEMAS: 'n',
      'LARGE OBJECTS': 'L',
    } as Record<string, string>)[overrides.objectType] ?? '?';
  }
  return value;
}

const options = {
  grantees: ['PUBLIC', 'anon', 'authenticated', 'service_role'],
  providerOwnedApplicationObjects: BigInt(0),
};

describe('preview default ACL boundary', () => {
  it('loads global and reviewed schema defaults from the catalog', () => {
    const query = defaultAclInspectionQuery.strings.join(' ');
    expect(query).toContain('defaults.defaclnamespace = 0');
    expect(query).toContain("namespace.nspname IN ('public', 'analytics')");
    expect(query).toContain('defaults.defaclnamespace <> 0 AND namespace.oid IS NULL');
    expect(query).toContain('privilege.is_grantable AS grantable');
    expect(query).toContain('LEFT JOIN pg_roles owner');
    expect(query).toContain('defaults.defaclrole::bigint AS "ownerOid"');
    expect(query).toContain('defaults.defaclobjtype::text AS "objectTypeCode"');
  });

  it('uses one application relkind contract that includes foreign tables in both verifiers', () => {
    expect(APPLICATION_RELATION_KINDS).toContain('f');
    const dataApiVerifier = readFileSync(
      resolve(process.cwd(), 'scripts/verify-preview-data-api-acls.ts'),
      'utf8',
    );
    const baselineVerifier = readFileSync(
      resolve(process.cwd(), 'scripts/verify-preview-prisma-baseline.ts'),
      'utf8',
    );
    expect(dataApiVerifier.match(/APPLICATION_RELATION_KINDS_SQL/g)).toHaveLength(3);
    expect(baselineVerifier.match(/APPLICATION_RELATION_KINDS_SQL/g)).toHaveLength(2);
  });

  it.each(['anon', 'authenticated', 'PUBLIC'])(
    'rejects unsafe global defaults granted to %s',
    (grantee) => {
      expect(() => verifyDefaultAclBoundary([row({ grantee })], options))
        .toThrow(`postgres:GLOBAL:TABLES:${grantee}:SELECT`);
    },
  );

  it('accepts and reports provider-managed global defaults', () => {
    expect(verifyDefaultAclBoundary([
      row({ ownerName: 'supabase_admin', privilege: 'MAINTAIN' }),
      row({ ownerName: 'supabase_admin', privilege: 'SELECT' }),
    ], options)).toEqual([{
      scope: 'GLOBAL',
      objectType: 'TABLES',
      grantee: 'anon',
      grantable: false,
      privileges: ['MAINTAIN', 'SELECT'],
    }]);
  });

  it('rejects schema-specific defaults owned outside the provider boundary', () => {
    expect(() => verifyDefaultAclBoundary([
      row({ namespaceOid: BigInt(2200), schema: 'public', grantee: 'authenticated' }),
    ], options)).toThrow('postgres:public:TABLES:authenticated:SELECT');
  });

  it('accepts and labels provider-managed schema-specific defaults', () => {
    expect(verifyDefaultAclBoundary([
      row({
        ownerName: 'supabase_admin',
        namespaceOid: BigInt(2200),
        schema: 'public',
        objectType: 'FUNCTIONS',
        grantee: 'authenticated',
        privilege: 'EXECUTE',
      }),
    ], options)).toEqual([{
      scope: 'public',
      objectType: 'FUNCTIONS',
      grantee: 'authenticated',
      grantable: false,
      privileges: ['EXECUTE'],
    }]);
  });

  it('distinguishes a global null namespace from a missing schema namespace', () => {
    expect(verifyDefaultAclBoundary([
      row({ ownerName: 'supabase_admin', namespaceOid: BigInt(0), schema: null }),
    ], options)[0]?.scope).toBe('GLOBAL');
    expect(() => verifyDefaultAclBoundary([
      row({ ownerName: 'supabase_admin', namespaceOid: BigInt(2200), schema: null }),
    ], options)).toThrow('namespace 2200 is missing or outside the reviewed schemas');
  });

  it('treats PostgreSQL 17 MAINTAIN as an unsafe table default privilege', () => {
    expect(() => verifyDefaultAclBoundary([
      row({ privilege: 'MAINTAIN', grantee: 'authenticated' }),
    ], options)).toThrow('postgres:GLOBAL:TABLES:authenticated:MAINTAIN');
  });

  it('fails closed when provider-managed defaults coexist with provider-owned app objects', () => {
    expect(() => verifyDefaultAclBoundary([
      row({ ownerName: 'supabase_admin' }),
    ], { ...options, providerOwnedApplicationObjects: BigInt(1) }))
      .toThrow('provider-owned application objects exist');
  });

  it('rejects provider defaults when the owned application object is a foreign table', () => {
    expect(APPLICATION_RELATION_KINDS).toContain('f');
    expect(() => verifyDefaultAclBoundary([
      row({ ownerName: 'supabase_admin' }),
    ], { ...options, providerOwnedApplicationObjects: BigInt(1) }))
      .toThrow('provider-owned application objects exist');
  });

  it.each([
    ['TABLES', 'SELECT'],
    ['SEQUENCES', 'USAGE'],
    ['FUNCTIONS', 'EXECUTE'],
  ])('rejects grantable provider-managed %s defaults', (objectType, privilege) => {
    expect(() => verifyDefaultAclBoundary([
      row({
        ownerName: 'supabase_admin',
        objectType,
        privilege,
        grantable: true,
      }),
    ], options)).toThrow(
      `supabase_admin:GLOBAL:${objectType}:anon:${privilege}:WITH GRANT OPTION`,
    );
  });

  it.each([
    ['TABLES', 'SELECT'],
    ['TABLES', 'INSERT'],
    ['TABLES', 'UPDATE'],
    ['TABLES', 'DELETE'],
    ['TABLES', 'TRUNCATE'],
    ['TABLES', 'REFERENCES'],
    ['TABLES', 'TRIGGER'],
    ['TABLES', 'MAINTAIN'],
    ['SEQUENCES', 'USAGE'],
    ['SEQUENCES', 'SELECT'],
    ['SEQUENCES', 'UPDATE'],
    ['FUNCTIONS', 'EXECUTE'],
  ])('accepts non-grantable provider-managed %s/%s defaults', (objectType, privilege) => {
    expect(verifyDefaultAclBoundary([
      row({ ownerName: 'supabase_admin', objectType, privilege }),
    ], options)).toEqual([expect.objectContaining({ objectType, grantable: false })]);
  });

  it('rejects unresolved default ACL owners before applying any provider exception', () => {
    expect(() => verifyDefaultAclBoundary([
      row({ ownerOid: BigInt(424242), ownerName: null, grantee: 'internal_role' }),
    ], options)).toThrow('default ACL owner OID 424242 cannot be resolved');
  });

  it.each([
    ['TABLES', 'EXECUTE'],
    ['SEQUENCES', 'MAINTAIN'],
    ['FUNCTIONS', 'SELECT'],
  ])('rejects malformed provider default matrix entry %s/%s', (objectType, privilege) => {
    expect(() => verifyDefaultAclBoundary([
      row({ ownerName: 'supabase_admin', objectType, privilege }),
    ], options)).toThrow('unsupported default ACL object/privilege combinations');
  });

  it.each([
    ['TYPES', 'USAGE'],
    ['SCHEMAS', 'CREATE'],
    ['SCHEMAS', 'USAGE'],
    ['LARGE OBJECTS', 'SELECT'],
    ['LARGE OBJECTS', 'UPDATE'],
  ])('rejects valid but non-allowlisted provider default type %s/%s', (objectType, privilege) => {
    expect(() => verifyDefaultAclBoundary([
      row({ ownerName: 'supabase_admin', objectType, privilege }),
    ], options)).toThrow('default ACL object types outside the provider exception');
  });

  it('rejects unknown future default ACL object codes', () => {
    expect(() => verifyDefaultAclBoundary([
      row({
        ownerName: 'supabase_admin',
        objectTypeCode: 'Z',
        objectType: 'UNKNOWN (Z)',
        privilege: 'USAGE',
      }),
    ], options)).toThrow('unsupported default ACL object/privilege combinations');
  });

  it('rejects a currently granted foreign table through the shared current-object gate', () => {
    expect(APPLICATION_RELATION_KINDS).toContain('f');
    expect(() => verifyNoCurrentDataApiGrants({
      relationGrants: BigInt(1),
      functionGrants: BigInt(0),
    })).toThrow('effective current relation, foreign-table, or sequence grants');
  });

  it('ignores unrelated grantees when their owner and namespace remain resolvable', () => {
    expect(verifyDefaultAclBoundary([
      row({ grantee: 'internal_role' }),
    ], options)).toEqual([]);
  });
});
