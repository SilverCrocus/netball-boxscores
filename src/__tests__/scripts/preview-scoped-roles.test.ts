import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_ROLE,
  ANALYTICS_VIEW_ALLOWLIST,
  OPERATIONS_FUNCTION_ALLOWLIST,
  OPERATIONS_ROLE,
  verifyPreviewScopedRoleContract,
  type PreviewScopedRoleCatalogState,
} from '../../../scripts/lib/preview-scoped-role-contract';

function fixture(): PreviewScopedRoleCatalogState {
  return {
    roles: [ANALYTICS_ROLE, OPERATIONS_ROLE].map((roleName) => ({
      roleName,
      canLogin: true,
      inherit: false,
      superuser: false,
      createRole: false,
      createDatabase: false,
      replication: false,
      bypassRls: false,
      memberships: BigInt(0),
      databaseConnect: true,
      roleSettings: [],
    })),
    settings: [
      { roleName: ANALYTICS_ROLE, setting: 'default_transaction_read_only=on' },
      { roleName: ANALYTICS_ROLE, setting: 'search_path=analytics' },
      { roleName: ANALYTICS_ROLE, setting: 'statement_timeout=2s' },
      { roleName: OPERATIONS_ROLE, setting: 'search_path=""' },
      { roleName: OPERATIONS_ROLE, setting: 'statement_timeout=2s' },
    ],
    schemaPrivileges: [
      { roleName: ANALYTICS_ROLE, schemaName: 'analytics', privilege: 'USAGE' },
      { roleName: OPERATIONS_ROLE, schemaName: 'analytics', privilege: 'USAGE' },
    ],
    relationObjects: ANALYTICS_VIEW_ALLOWLIST.map((relationName) => ({
      schemaName: 'analytics',
      relationName,
      relationKind: 'v',
      owner: 'postgres',
    })),
    relationPrivileges: ANALYTICS_VIEW_ALLOWLIST.map((relationName) => ({
      roleName: ANALYTICS_ROLE,
      schemaName: 'analytics',
      relationName,
      relationKind: 'v',
      owner: 'postgres',
      privilege: 'SELECT',
    })),
    sequencePrivileges: [],
    functionObjects: OPERATIONS_FUNCTION_ALLOWLIST.map((signature) => ({
      signature,
      owner: 'postgres',
      securityDefiner: true,
      searchPath: '""',
    })),
    functionPrivileges: OPERATIONS_FUNCTION_ALLOWLIST.map((signature) => ({
      roleName: OPERATIONS_ROLE,
      signature,
      owner: 'postgres',
      securityDefiner: true,
      searchPath: '""',
      privilege: 'EXECUTE',
    })),
  };
}

describe('preview scoped-role contract', () => {
  it('accepts the exact reviewed effective allowlists', () => {
    expect(verifyPreviewScopedRoleContract(fixture())).toEqual({
      analyticsViews: 14,
      operationsFunctions: 2,
    });
  });

  it('fails closed for missing or extra relation grants', () => {
    const missing = fixture();
    missing.relationPrivileges.pop();
    expect(() => verifyPreviewScopedRoleContract(missing)).toThrow('missing=[');

    const extra = fixture();
    extra.relationPrivileges.push({
      roleName: ANALYTICS_ROLE,
      schemaName: 'analytics',
      relationName: 'player_match_fact',
      relationKind: 'v',
      owner: 'postgres',
      privilege: 'SELECT',
    });
    expect(() => verifyPreviewScopedRoleContract(extra)).toThrow('extra=[');
  });

  it('fails closed for missing or extra function grants', () => {
    const missing = fixture();
    missing.functionPrivileges.pop();
    expect(() => verifyPreviewScopedRoleContract(missing)).toThrow('effective function privileges');

    const extra = fixture();
    extra.functionPrivileges.push({
      roleName: OPERATIONS_ROLE,
      signature: 'analytics.queue_match_invalidation(text)',
      owner: 'postgres',
      securityDefiner: true,
      searchPath: '""',
      privilege: 'EXECUTE',
    });
    expect(() => verifyPreviewScopedRoleContract(extra)).toThrow('extra=[');
  });

  it('fails closed for wrong owners and unsafe function settings', () => {
    const wrongViewOwner = fixture();
    wrongViewOwner.relationObjects[0].owner = 'supabase_admin';
    expect(() => verifyPreviewScopedRoleContract(wrongViewOwner)).toThrow('not postgres-owned');

    const wrongFunctionOwner = fixture();
    wrongFunctionOwner.functionObjects[0] = {
      ...wrongFunctionOwner.functionObjects[0],
      owner: 'supabase_admin',
    };
    expect(() => verifyPreviewScopedRoleContract(wrongFunctionOwner)).toThrow('not postgres-owned');

    const invokerFunction = fixture();
    invokerFunction.functionObjects[0] = {
      ...invokerFunction.functionObjects[0],
      securityDefiner: false,
    };
    expect(() => verifyPreviewScopedRoleContract(invokerFunction)).toThrow('not SECURITY DEFINER');

    const unsafeSearchPath = fixture();
    unsafeSearchPath.functionObjects[0] = {
      ...unsafeSearchPath.functionObjects[0],
      searchPath: 'analytics',
    };
    expect(() => verifyPreviewScopedRoleContract(unsafeSearchPath)).toThrow('empty search_path');
  });

  it('fails closed for role attributes, memberships, settings, and schema drift', () => {
    const elevated = fixture();
    elevated.roles[0].bypassRls = true;
    expect(() => verifyPreviewScopedRoleContract(elevated)).toThrow('bypasses RLS');

    const membership = fixture();
    membership.roles[1].memberships = BigInt(1);
    expect(() => verifyPreviewScopedRoleContract(membership)).toThrow('role membership');

    const wrongTimeout = fixture();
    wrongTimeout.settings = wrongTimeout.settings.map((row) =>
      row.setting === 'statement_timeout=2s' ? { ...row, setting: 'statement_timeout=20s' } : row);
    expect(() => verifyPreviewScopedRoleContract(wrongTimeout)).toThrow('database role settings');

    const writableAnalytics = fixture();
    writableAnalytics.settings = writableAnalytics.settings.filter(
      (row) => row.setting !== 'default_transaction_read_only=on',
    );
    expect(() => verifyPreviewScopedRoleContract(writableAnalytics)).toThrow('database role settings');

    const publicUsage = fixture();
    publicUsage.schemaPrivileges.push({
      roleName: OPERATIONS_ROLE,
      schemaName: 'auth',
      privilege: 'USAGE',
    });
    expect(() => verifyPreviewScopedRoleContract(publicUsage)).toThrow('application schema privileges');
  });

  it('keeps the executable verifier contract in lockstep with both reviewed SQL files', () => {
    const analyticsSql = readFileSync(
      path.resolve('scripts/provision-analytics-role.sql'), 'utf8',
    );
    const operationsSql = readFileSync(
      path.resolve('scripts/provision-stats-operations-role.sql'), 'utf8',
    ).replace(/\s+/g, ' ');
    const sqlViews = [...analyticsSql.matchAll(
      /GRANT SELECT ON analytics\.([a-z_]+) TO centrepass_analytics;/g,
    )].map((match) => match[1]);
    const sqlFunctions = [...operationsSql.matchAll(
      /GRANT EXECUTE ON FUNCTION (analytics\.[^(]+\([^;]+?\)) TO centrepass_stats_operations;/g,
    )].map((match) => match[1].toLowerCase().replace(/\s+/g, ''));
    expect(sqlViews).toEqual([...ANALYTICS_VIEW_ALLOWLIST]);
    expect(sqlFunctions).toEqual([...OPERATIONS_FUNCTION_ALLOWLIST]);
  });

  it('keeps provisioning credentials in memory and the final verifier read-only', () => {
    const provisioning = readFileSync(
      path.resolve('scripts/provision-preview-scoped-roles.ts'), 'utf8',
    );
    const verifier = readFileSync(
      path.resolve('scripts/verify-preview-scoped-roles.ts'), 'utf8',
    );
    expect(provisioning).toContain('randomBytes(32)');
    expect(provisioning).toContain('\\getenv');
    expect(provisioning).not.toContain('--set=analytics_password');
    expect(provisioning).not.toContain('--set=operations_password');
    expect(verifier).toContain('$queryRaw');
    expect(verifier).not.toContain('$executeRaw');
    expect(verifier).toContain("namespace.nspname NOT IN ('pg_catalog', 'information_schema')");
    expect(verifier).toContain("has_schema_privilege(reviewed.\"roleName\", namespace.oid, 'USAGE')");
    expect(verifier).not.toContain("namespace.nspname IN ('public', 'analytics')");
  });
});
