import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { verifyPreviewDatabaseTarget } from './lib/preview-database-target';
import {
  verifyPreviewScopedRoleContract,
  type FunctionObjectRow,
  type FunctionPrivilegeRow,
  type RelationObjectRow,
  type RelationPrivilegeRow,
  type RoleMembershipRow,
  type RoleSettingRow,
  type SchemaPrivilegeRow,
  type ScopedRoleRow,
} from './lib/preview-scoped-role-contract';

function verifyFreshLocalTarget() {
  for (const name of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    const raw = process.env[name];
    if (!raw) throw new Error(`Preview scoped-role verification failed: ${name} is required`);
    const url = new URL(raw);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
      throw new Error(`Preview scoped-role verification failed: ${name} is not local`);
    }
  }
}

async function main() {
  const freshLocalRehearsal = process.env.FRESH_MIGRATION_REHEARSAL === 'true';
  const target = freshLocalRehearsal ? null : verifyPreviewDatabaseTarget();
  if (freshLocalRehearsal) verifyFreshLocalTarget();
  const [
    roles,
    memberships,
    settings,
    schemaPrivileges,
    relationObjects,
    relationPrivileges,
    sequencePrivileges,
    functionObjects,
    functionPrivileges,
  ] = await Promise.all([
    prisma.$queryRaw<ScopedRoleRow[]>(Prisma.sql`
      WITH reviewed("roleName") AS (
        VALUES ('centrepass_analytics'), ('centrepass_stats_operations')
      )
      SELECT role.rolname AS "roleName",
        role.rolcanlogin AS "canLogin", role.rolinherit AS inherit,
        role.rolsuper AS superuser, role.rolcreaterole AS "createRole",
        role.rolcreatedb AS "createDatabase", role.rolreplication AS replication,
        role.rolbypassrls AS "bypassRls",
        (SELECT COUNT(*) FROM pg_auth_members membership
          WHERE membership.member = role.oid)::bigint AS "memberOfCount",
        has_database_privilege(role.rolname, current_database(), 'CONNECT') AS "databaseConnect",
        COALESCE(role.rolconfig, ARRAY[]::text[]) AS "roleSettings"
      FROM reviewed
      JOIN pg_roles role ON role.rolname = reviewed."roleName"
      ORDER BY role.rolname`),
    prisma.$queryRaw<RoleMembershipRow[]>(Prisma.sql`
      SELECT granted.rolname AS "grantedRole", member.rolname AS "memberRole",
        membership.admin_option AS "adminOption",
        membership.inherit_option AS "inheritOption",
        membership.set_option AS "setOption", grantor.rolname AS "grantorRole"
      FROM pg_auth_members membership
      JOIN pg_roles granted ON granted.oid = membership.roleid
      JOIN pg_roles member ON member.oid = membership.member
      JOIN pg_roles grantor ON grantor.oid = membership.grantor
      WHERE granted.rolname IN ('centrepass_analytics', 'centrepass_stats_operations')
        OR member.rolname IN ('centrepass_analytics', 'centrepass_stats_operations')
      ORDER BY granted.rolname, member.rolname`),
    prisma.$queryRaw<RoleSettingRow[]>(Prisma.sql`
      SELECT role.rolname AS "roleName", setting
      FROM pg_roles role
      JOIN pg_db_role_setting configured ON configured.setrole = role.oid
      CROSS JOIN LATERAL unnest(configured.setconfig) setting
      WHERE role.rolname IN ('centrepass_analytics', 'centrepass_stats_operations')
        AND configured.setdatabase IN (
          0, (SELECT oid FROM pg_database WHERE datname = current_database())
        )
      ORDER BY role.rolname, setting`),
    prisma.$queryRaw<SchemaPrivilegeRow[]>(Prisma.sql`
      WITH reviewed("roleName") AS (
        VALUES ('centrepass_analytics'), ('centrepass_stats_operations')
      ), privileges(privilege) AS (VALUES ('USAGE'), ('CREATE'))
      SELECT reviewed."roleName", namespace.nspname AS "schemaName", privileges.privilege
      FROM reviewed
      CROSS JOIN pg_namespace namespace
      CROSS JOIN privileges
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp%'
        AND has_schema_privilege(
          reviewed."roleName", namespace.oid, privileges.privilege
        )
      ORDER BY reviewed."roleName", namespace.nspname, privileges.privilege`),
    prisma.$queryRaw<RelationObjectRow[]>(Prisma.sql`
      SELECT namespace.nspname AS "schemaName", relation.relname AS "relationName",
        relation.relkind::text AS "relationKind", owner.rolname AS owner
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles owner ON owner.oid = relation.relowner
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp%'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      ORDER BY namespace.nspname, relation.relname`),
    prisma.$queryRaw<RelationPrivilegeRow[]>(Prisma.sql`
      WITH reviewed("roleName") AS (
        VALUES ('centrepass_analytics'), ('centrepass_stats_operations')
      ), privileges(privilege) AS (
        VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
          ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
      )
      SELECT reviewed."roleName", namespace.nspname AS "schemaName",
        relation.relname AS "relationName", relation.relkind::text AS "relationKind",
        owner.rolname AS owner, privileges.privilege
      FROM reviewed
      CROSS JOIN pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles owner ON owner.oid = relation.relowner
      CROSS JOIN privileges
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp%'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND has_schema_privilege(reviewed."roleName", namespace.oid, 'USAGE')
        AND has_table_privilege(
          reviewed."roleName", relation.oid, privileges.privilege
        )
      ORDER BY reviewed."roleName", namespace.nspname, relation.relname, privileges.privilege`),
    prisma.$queryRaw<RelationPrivilegeRow[]>(Prisma.sql`
      WITH reviewed("roleName") AS (
        VALUES ('centrepass_analytics'), ('centrepass_stats_operations')
      ), privileges(privilege) AS (VALUES ('USAGE'), ('SELECT'), ('UPDATE'))
      SELECT reviewed."roleName", namespace.nspname AS "schemaName",
        relation.relname AS "relationName", relation.relkind::text AS "relationKind",
        owner.rolname AS owner, privileges.privilege
      FROM reviewed
      CROSS JOIN pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles owner ON owner.oid = relation.relowner
      CROSS JOIN privileges
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp%'
        AND relation.relkind = 'S'
        AND has_schema_privilege(reviewed."roleName", namespace.oid, 'USAGE')
        AND has_sequence_privilege(
          reviewed."roleName", relation.oid, privileges.privilege
        )
      ORDER BY reviewed."roleName", namespace.nspname, relation.relname, privileges.privilege`),
    prisma.$queryRaw<FunctionObjectRow[]>(Prisma.sql`
      SELECT function.oid::regprocedure::text AS signature, owner.rolname AS owner,
        function.prosecdef AS "securityDefiner",
        (SELECT split_part(setting, '=', 2)
          FROM unnest(COALESCE(function.proconfig, ARRAY[]::text[])) setting
          WHERE setting LIKE 'search_path=%' LIMIT 1) AS "searchPath"
      FROM pg_proc function
      JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
      JOIN pg_roles owner ON owner.oid = function.proowner
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp%'
      ORDER BY signature`),
    prisma.$queryRaw<FunctionPrivilegeRow[]>(Prisma.sql`
      WITH reviewed("roleName") AS (
        VALUES ('centrepass_analytics'), ('centrepass_stats_operations')
      )
      SELECT reviewed."roleName", function.oid::regprocedure::text AS signature,
        owner.rolname AS owner, function.prosecdef AS "securityDefiner",
        (SELECT split_part(setting, '=', 2)
          FROM unnest(COALESCE(function.proconfig, ARRAY[]::text[])) setting
          WHERE setting LIKE 'search_path=%' LIMIT 1) AS "searchPath",
        'EXECUTE'::text AS privilege
      FROM reviewed
      CROSS JOIN pg_proc function
      JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
      JOIN pg_roles owner ON owner.oid = function.proowner
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp%'
        AND has_schema_privilege(reviewed."roleName", namespace.oid, 'USAGE')
        AND has_function_privilege(reviewed."roleName", function.oid, 'EXECUTE')
      ORDER BY reviewed."roleName", signature`),
  ]);

  const verified = verifyPreviewScopedRoleContract({
    roles,
    memberships,
    settings,
    schemaPrivileges,
    relationObjects,
    relationPrivileges,
    sequencePrivileges,
    functionObjects,
    functionPrivileges,
  }, { supabasePreview: target !== null });
  console.log(JSON.stringify({
    status: 'verified-exact-preview-scoped-role-contracts',
    ...(target ? {
      expectedPreviewProjectRef: target.expectedPreviewProjectRef,
      productionProjectRef: target.productionProjectRef,
    } : { target: 'fresh-local-postgres-17' }),
    analyticsViews: verified.analyticsViews,
    operationsFunctions: verified.operationsFunctions,
    unexpectedPrivileges: 0,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
