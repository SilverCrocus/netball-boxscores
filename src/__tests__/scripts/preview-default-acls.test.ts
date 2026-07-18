import { describe, expect, it } from 'vitest';
import {
  type DefaultAclPrivilegeRow,
  defaultAclInspectionQuery,
  verifyDefaultAclBoundary,
} from '../../../scripts/lib/preview-default-acl-contract';

function row(overrides: Partial<DefaultAclPrivilegeRow> = {}): DefaultAclPrivilegeRow {
  return {
    owner: 'postgres',
    namespaceOid: BigInt(0),
    schema: null,
    objectType: 'TABLES',
    grantee: 'anon',
    privilege: 'SELECT',
    ...overrides,
  };
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
      row({ owner: 'supabase_admin', privilege: 'MAINTAIN' }),
      row({ owner: 'supabase_admin', privilege: 'SELECT' }),
    ], options)).toEqual([{
      scope: 'GLOBAL',
      objectType: 'TABLES',
      grantee: 'anon',
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
        owner: 'supabase_admin',
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
      privileges: ['EXECUTE'],
    }]);
  });

  it('distinguishes a global null namespace from a missing schema namespace', () => {
    expect(verifyDefaultAclBoundary([
      row({ owner: 'supabase_admin', namespaceOid: BigInt(0), schema: null }),
    ], options)[0]?.scope).toBe('GLOBAL');
    expect(() => verifyDefaultAclBoundary([
      row({ owner: 'supabase_admin', namespaceOid: BigInt(2200), schema: null }),
    ], options)).toThrow('namespace 2200 is missing or outside the reviewed schemas');
  });

  it('treats PostgreSQL 17 MAINTAIN as an unsafe table default privilege', () => {
    expect(() => verifyDefaultAclBoundary([
      row({ privilege: 'MAINTAIN', grantee: 'authenticated' }),
    ], options)).toThrow('postgres:GLOBAL:TABLES:authenticated:MAINTAIN');
  });

  it('fails closed when provider-managed defaults coexist with provider-owned app objects', () => {
    expect(() => verifyDefaultAclBoundary([
      row({ owner: 'supabase_admin' }),
    ], { ...options, providerOwnedApplicationObjects: BigInt(1) }))
      .toThrow('provider-owned application objects exist');
  });

  it('ignores unrelated grantees and non-Data-API default object types', () => {
    expect(verifyDefaultAclBoundary([
      row({ grantee: 'internal_role' }),
      row({ objectType: 'TYPES', grantee: 'anon', privilege: 'USAGE' }),
    ], options)).toEqual([]);
  });
});
