import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { verifyPreviewDatabaseTarget } from './lib/preview-database-target';

interface AclCounts {
  relationGrants: bigint;
  functionGrants: bigint;
  postgresDefaultGrants: bigint;
  unsupportedDefaultGrants: bigint;
  nonPostgresRelations: bigint;
  nonPostgresFunctions: bigint;
}

interface ProviderDefaultRow {
  schema: string;
  objectType: string;
  grantee: string;
  privileges: string[];
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Preview Data API ACL verification failed: ${message}`);
}

async function main() {
  const target = verifyPreviewDatabaseTarget();
  const [counts, providerDefaults] = await Promise.all([
    prisma.$queryRaw<AclCounts[]>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM pg_class object
          JOIN pg_namespace namespace ON namespace.oid = object.relnamespace
          CROSS JOIN LATERAL aclexplode(COALESCE(
            object.relacl,
            acldefault(CASE WHEN object.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END,
              object.relowner)
          )) privilege
          LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
          WHERE namespace.nspname IN ('public', 'analytics')
            AND object.relkind IN ('r', 'p', 'v', 'm', 'S')
            AND (privilege.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated', 'service_role'))
        )::bigint AS "relationGrants",
        (SELECT COUNT(*) FROM pg_proc function
          JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
          CROSS JOIN LATERAL aclexplode(COALESCE(
            function.proacl, acldefault('f'::"char", function.proowner)
          )) privilege
          LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
          WHERE namespace.nspname IN ('public', 'analytics')
            AND (privilege.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated', 'service_role'))
        )::bigint AS "functionGrants",
        (SELECT COUNT(*) FROM pg_default_acl defaults
          JOIN pg_roles owner ON owner.oid = defaults.defaclrole
          LEFT JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
          CROSS JOIN LATERAL aclexplode(defaults.defaclacl) privilege
          LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
          WHERE namespace.nspname IN ('public', 'analytics') AND owner.rolname = 'postgres'
            AND (privilege.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated', 'service_role'))
        )::bigint AS "postgresDefaultGrants",
        (SELECT COUNT(*) FROM pg_default_acl defaults
          JOIN pg_roles owner ON owner.oid = defaults.defaclrole
          LEFT JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
          CROSS JOIN LATERAL aclexplode(defaults.defaclacl) privilege
          LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
          WHERE namespace.nspname IN ('public', 'analytics')
            AND owner.rolname NOT IN ('postgres', 'supabase_admin')
            AND (privilege.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated', 'service_role'))
        )::bigint AS "unsupportedDefaultGrants",
        (SELECT COUNT(*) FROM pg_class object
          JOIN pg_namespace namespace ON namespace.oid = object.relnamespace
          JOIN pg_roles owner ON owner.oid = object.relowner
          WHERE namespace.nspname IN ('public', 'analytics')
            AND object.relkind IN ('r', 'p', 'v', 'm', 'S') AND owner.rolname <> 'postgres'
        )::bigint AS "nonPostgresRelations",
        (SELECT COUNT(*) FROM pg_proc function
          JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
          JOIN pg_roles owner ON owner.oid = function.proowner
          WHERE namespace.nspname IN ('public', 'analytics') AND owner.rolname <> 'postgres'
        )::bigint AS "nonPostgresFunctions"`),
    prisma.$queryRaw<ProviderDefaultRow[]>(Prisma.sql`
      SELECT namespace.nspname AS schema,
        CASE defaults.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES'
          WHEN 'f' THEN 'FUNCTIONS' ELSE defaults.defaclobjtype::text END AS "objectType",
        COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
        ARRAY_AGG(privilege.privilege_type ORDER BY privilege.privilege_type) AS privileges
      FROM pg_default_acl defaults JOIN pg_roles owner ON owner.oid = defaults.defaclrole
      LEFT JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
      CROSS JOIN LATERAL aclexplode(defaults.defaclacl) privilege
      LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
      WHERE namespace.nspname IN ('public', 'analytics') AND owner.rolname = 'supabase_admin'
        AND (privilege.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated', 'service_role'))
      GROUP BY namespace.nspname, defaults.defaclobjtype, COALESCE(grantee.rolname, 'PUBLIC')
      ORDER BY schema, "objectType", grantee`),
  ]);
  const state = counts[0];
  invariant(state, 'ACL count query returned no row');
  invariant(state.relationGrants === BigInt(0),
    `found ${state.relationGrants} effective current relation or sequence grants`);
  invariant(state.functionGrants === BigInt(0),
    `found ${state.functionGrants} effective current function grants`);
  invariant(state.postgresDefaultGrants === BigInt(0),
    `found ${state.postgresDefaultGrants} postgres-owned future-object grants`);
  invariant(state.unsupportedDefaultGrants === BigInt(0),
    `found ${state.unsupportedDefaultGrants} unsupported provider default grants`);
  invariant(state.nonPostgresRelations === BigInt(0),
    `found ${state.nonPostgresRelations} application relations not owned by postgres`);
  invariant(state.nonPostgresFunctions === BigInt(0),
    `found ${state.nonPostgresFunctions} application functions not owned by postgres`);
  console.log(JSON.stringify({
    status: 'verified-owner-aware-data-api-object-boundary',
    expectedPreviewProjectRef: target.expectedPreviewProjectRef,
    productionProjectRef: target.productionProjectRef,
    schemas: ['public', 'analytics'],
    grantees: ['PUBLIC', 'anon', 'authenticated', 'service_role'],
    currentRelationGrants: 0,
    currentFunctionGrants: 0,
    postgresOwnedDefaultGrants: 0,
    nonPostgresApplicationRelations: 0,
    nonPostgresApplicationFunctions: 0,
    providerManagedSupabaseAdminDefaults: providerDefaults,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
