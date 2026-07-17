# Analytics and Ask CentrePass database roles

CentrePass analytics live in the private `analytics` Postgres schema. Supabase's Data API exposes `public` by default; do not add `analytics` to the project's exposed-schema setting. The migration revokes `PUBLIC`, `anon`, and `authenticated` access.

The reviewed views use PostgreSQL's owner-run view behavior inside that private schema. This lets the server-side analytics login query a deliberately small surface without receiving `SELECT` on source tables. If a view is ever moved into an exposed schema, redesign its access policy and use `security_invoker = true` before release.

Two separate server credentials are required:

- `centrepass_analytics` / `ANALYTICS_DATABASE_URL`: `SELECT` only on the explicit view allowlist in `scripts/provision-analytics-role.sql`.
- `centrepass_stats_operations` / `STATS_OPERATIONS_DATABASE_URL`: no relation privileges and `EXECUTE` only on the rate-limit reservation and telemetry functions.

Do not reuse `DATABASE_URL`, `DIRECT_URL`, or either scoped credential for the other responsibility.

Both scoped runtime URLs must use the Supavisor **transaction pooler** endpoint (normally port `6543`). The application always supplies Prisma's transaction-pooler compatibility settings: `pgbouncer=true`, `connection_limit=5` for analytics or `2` for operations, and `pool_timeout=5`. Those bounded parameters override values in the stored URL. This avoids prepared-statement collisions and prevents either public feature from opening an unbounded process-local pool. `DIRECT_URL`, Prisma migrations, both provisioning scripts, and owner-level verification must use Supabase's direct connection or Supavisor session mode instead; never run DDL or role administration through transaction mode.

## Provision or rotate

1. Generate two independent random passwords in the deployment secret manager. Do not put them in shell history, `.env`, a migration, or this repository.
2. Connect to the direct Supabase Postgres endpoint (or Supavisor session mode) as the database owner. Do not use the transaction pooler for migrations or role administration.
3. Run the provisioning script with the password supplied through a protected `psql` variable or temporary secret-injected process environment:

   ```bash
   psql "$DIRECT_URL" --set=analytics_password="$ANALYTICS_PASSWORD" \
     --file scripts/provision-analytics-role.sql

   psql "$DIRECT_URL" --set=operations_password="$STATS_OPERATIONS_PASSWORD" \
     --file scripts/provision-stats-operations-role.sql
   ```

4. Store the two dedicated Supavisor transaction-pooler connection strings in the server-side deployment secret manager. Never expose either through a `NEXT_PUBLIC_` variable or browser bundle. The runtime adds the required Prisma pool parameters without logging the resulting URLs.
5. Generate an independent `STATS_RATE_LIMIT_SECRET` of at least 32 random characters. It is used for domain-separated HMACs and must not be reused as a database password.
6. Keep `ANALYTICS_FEATURES_ENABLED=false` and `ASK_CENTREPASS_ENABLED=false` until both role checks and readiness probes pass. Ask CentrePass requires analytics.
7. Restart the web service, verify readiness, enable analytics, verify again, then enable Ask CentrePass and verify again.

Both scripts are idempotent for password rotation. The analytics script enforces `NOINHERIT`, `NOBYPASSRLS`, read-only transactions, a two-second statement timeout, an `analytics`-only search path, and an exact view allowlist. The operations script enforces `NOINHERIT`, `NOBYPASSRLS`, a two-second statement timeout, an empty search path, no relation privileges, and an exact two-function allowlist.

The migration also removes existing and future `public`-schema privileges for `PUBLIC`, `anon`, and `authenticated`. Prisma migrations normally run as `postgres`, so that owner's default privileges are repaired directly. The migration repairs `supabase_admin` defaults when its execution role is a member; otherwise it emits a warning. Treat that warning as a release blocker until an owner-level session runs the equivalent three `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` revokes and the audit below passes. The existing trigger functions continue to run as triggers; callers do not need direct `EXECUTE` on them.

## Verification

As the database owner, verify neither current nor future Data API privileges remain broad:

```sql
SELECT table_schema, table_name, grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;

SELECT
  defaults.defaclrole::regrole AS owner,
  defaults.defaclobjtype,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee,
  acl.privilege_type
FROM pg_catalog.pg_default_acl defaults
CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) acl
WHERE defaults.defaclnamespace = 'public'::regnamespace
  AND defaults.defaclrole IN ('postgres'::regrole, 'supabase_admin'::regrole)
  AND (
    acl.grantee = 0
    OR pg_catalog.pg_get_userbyid(acl.grantee) IN ('anon', 'authenticated')
  )
ORDER BY owner, defaults.defaclobjtype, grantee, acl.privilege_type;

SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated')
ORDER BY routine_name, grantee;
```

All three queries must return no effective grants to those roles. In particular, verify `cp_prepare_legacy_match_write`, `cp_sync_legacy_match_foundation`, and `cp_validate_competition_topology` have no direct Data API execution grant. Do not enable either feature flag if the audit fails.

Connect as the analytics login and verify:

```sql
SHOW default_transaction_read_only;
SHOW statement_timeout;
SHOW search_path;

SELECT count(*) FROM analytics.competition_directory;
SELECT count(*) FROM analytics.player_match_read;

-- Both statements must fail.
SELECT count(*) FROM public."Match";
DELETE FROM analytics.ranking_snapshot WHERE false;
```

Connect as the operations login and verify:

```sql
SHOW statement_timeout;
SHOW search_path;

-- Must succeed with a 64-character hexadecimal HMAC.
SELECT * FROM analytics.reserve_stat_query_rate_limit(repeat('a', 64));

-- Both statements must fail.
SELECT count(*) FROM analytics.query_rate_limit_bucket;
SELECT count(*) FROM analytics.player_match_fact;
```

Run query-plan checks through the same allowlisted analytics login used by the application, with known fixture IDs:

```bash
psql "$ANALYTICS_DATABASE_URL" \
  --set=competition_id='COMPETITION_ID' \
  --set=position='GA' \
  --file scripts/check-analytics-query-plans.sql
```

Record execution time, buffers, and row estimates. Add materialized views only after these plans show a measured need.

## Rotation and rollback

- Rotate either database credential by re-running only its provisioning script, updating only its deployment secret, and restarting the connection pool.
- Rotate `STATS_RATE_LIMIT_SECRET` independently. Rotation changes future HMACs and intentionally resets the effective rate-limit identity.
- Revoke immediately with `ALTER ROLE centrepass_analytics NOLOGIN;` or `ALTER ROLE centrepass_stats_operations NOLOGIN;` if a credential is suspected to be exposed.
- `ASK_CENTREPASS_ENABLED=false` disables Ask CentrePass while leaving other analytics available. `ANALYTICS_FEATURES_ENABLED=false` disables the complete analytics surface and implicitly disables Ask CentrePass.
- Neither kill switch removes snapshots, record history, telemetry, or invalidation state.

References: [Supabase Row Level Security and views](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Supabase custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas).
