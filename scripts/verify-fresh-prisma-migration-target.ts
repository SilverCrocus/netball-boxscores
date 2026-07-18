import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Fresh Prisma migration rehearsal failed: ${message}`);
}

function verifyLocalUrl(name: 'DATABASE_URL' | 'DIRECT_URL') {
  const raw = process.env[name];
  invariant(raw, `${name} is required`);
  const url = new URL(raw);
  invariant(['127.0.0.1', 'localhost', '::1'].includes(url.hostname),
    `${name} must target the ephemeral local PostgreSQL service`);
}

async function main() {
  verifyLocalUrl('DATABASE_URL');
  verifyLocalUrl('DIRECT_URL');
  const [state] = await prisma.$queryRaw<Array<{ serverVersion: string; publicTables: bigint }>>(Prisma.sql`
    SELECT current_setting('server_version') AS "serverVersion",
      (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE')::bigint AS "publicTables"`);
  invariant(state?.serverVersion.startsWith('17.'), `expected PostgreSQL 17, found ${state?.serverVersion}`);
  invariant(state.publicTables === BigInt(0), `expected zero public tables, found ${state.publicTables}`);
  const requiredRoles = ['anon', 'authenticated', 'service_role'];
  const existing = await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`
    SELECT rolname AS name FROM pg_roles WHERE rolname IN (${Prisma.join(requiredRoles)})`);
  invariant(existing.length === 0, 'Supabase compatibility roles already exist before explicit seeding');
  for (const role of requiredRoles) {
    await prisma.$executeRawUnsafe(
      `CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
  }
  const roles = await prisma.$queryRaw<Array<{
    name: string;
    canLogin: boolean;
    inherits: boolean;
    superuser: boolean;
    createDb: boolean;
    createRole: boolean;
    replication: boolean;
    bypassRls: boolean;
  }>>(Prisma.sql`
    SELECT rolname AS name, rolcanlogin AS "canLogin", rolinherit AS inherits,
      rolsuper AS superuser, rolcreatedb AS "createDb", rolcreaterole AS "createRole",
      rolreplication AS replication, rolbypassrls AS "bypassRls"
    FROM pg_roles WHERE rolname IN (${Prisma.join(requiredRoles)}) ORDER BY rolname`);
  invariant(roles.length === requiredRoles.length, 'not every required compatibility role was seeded');
  invariant(roles.every((role) => !role.canLogin && !role.inherits && !role.superuser &&
    !role.createDb && !role.createRole && !role.replication && !role.bypassRls),
  'compatibility role privileges exceed the minimal migration requirement');
  console.log(JSON.stringify({
    status: 'verified-empty-ephemeral-postgres-17-with-minimal-supabase-roles',
    publicTables: 0,
    seededRoles: requiredRoles,
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
