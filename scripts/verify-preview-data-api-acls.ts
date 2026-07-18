import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  APPLICATION_RELATION_KINDS_SQL,
  DATA_API_DEFAULT_ACL_GRANTEES,
  type DefaultAclPrivilegeRow,
  defaultAclInspectionQuery,
  verifyDefaultAclBoundary,
  verifyNoCurrentDataApiGrants,
} from './lib/preview-default-acl-contract';
import { verifyPreviewDatabaseTarget } from './lib/preview-database-target';

interface AclCounts {
  relationGrants: bigint;
  functionGrants: bigint;
  nonPostgresRelations: bigint;
  nonPostgresFunctions: bigint;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Preview Data API ACL verification failed: ${message}`);
}

async function main() {
  const target = verifyPreviewDatabaseTarget();
  const [counts, defaultAclRows] = await Promise.all([
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
            AND object.relkind IN (${APPLICATION_RELATION_KINDS_SQL})
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
        (SELECT COUNT(*) FROM pg_class object
          JOIN pg_namespace namespace ON namespace.oid = object.relnamespace
          JOIN pg_roles owner ON owner.oid = object.relowner
          WHERE namespace.nspname IN ('public', 'analytics')
            AND object.relkind IN (${APPLICATION_RELATION_KINDS_SQL})
            AND owner.rolname <> 'postgres'
        )::bigint AS "nonPostgresRelations",
        (SELECT COUNT(*) FROM pg_proc function
          JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
          JOIN pg_roles owner ON owner.oid = function.proowner
          WHERE namespace.nspname IN ('public', 'analytics') AND owner.rolname <> 'postgres'
        )::bigint AS "nonPostgresFunctions"`),
    prisma.$queryRaw<DefaultAclPrivilegeRow[]>(defaultAclInspectionQuery),
  ]);
  const state = counts[0];
  invariant(state, 'ACL count query returned no row');
  verifyNoCurrentDataApiGrants(state);
  invariant(state.nonPostgresRelations === BigInt(0),
    `found ${state.nonPostgresRelations} application relations not owned by postgres`);
  invariant(state.nonPostgresFunctions === BigInt(0),
    `found ${state.nonPostgresFunctions} application functions not owned by postgres`);
  const providerDefaults = verifyDefaultAclBoundary(defaultAclRows, {
    grantees: DATA_API_DEFAULT_ACL_GRANTEES,
    providerOwnedApplicationObjects: state.nonPostgresRelations + state.nonPostgresFunctions,
  });
  console.log(JSON.stringify({
    status: 'verified-owner-aware-data-api-object-boundary',
    expectedPreviewProjectRef: target.expectedPreviewProjectRef,
    productionProjectRef: target.productionProjectRef,
    schemas: ['public', 'analytics'],
    grantees: ['PUBLIC', 'anon', 'authenticated', 'service_role'],
    currentRelationGrants: 0,
    currentFunctionGrants: 0,
    postgresOwnedGlobalOrSchemaDefaultGrants: 0,
    nonPostgresApplicationRelations: 0,
    nonPostgresApplicationFunctions: 0,
    providerManagedSupabaseAdminDefaults: providerDefaults,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
