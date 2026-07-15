# Analytics read-only database role

CentrePass analytics live in the private `analytics` Postgres schema. Supabase's Data API exposes `public` by default; do not add `analytics` to the project's exposed-schema setting. The migration revokes `PUBLIC`, `anon`, and `authenticated` access.

The reviewed views are deliberately private security-definer views. That lets the server-side analytics login query the reviewed surface without receiving `SELECT` on source tables. If a view is ever moved into an exposed schema, redesign its access policy and use `security_invoker = true` before release.

## Provision or rotate

1. Generate a new random password in the deployment secret manager. Do not put it in shell history, `.env`, a migration, or this repository.
2. Connect to the direct Supabase Postgres endpoint as the database owner. Do not use the transaction pooler for role administration.
3. Run the provisioning script with the password supplied through a protected `psql` variable or temporary secret-injected process environment:

   ```bash
   psql "$DIRECT_URL" --set=analytics_password="$ANALYTICS_PASSWORD" \
     --file scripts/provision-analytics-role.sql
   ```

4. Store a dedicated connection string for `centrepass_analytics` in the server-side deployment secret manager. Never expose it through a `NEXT_PUBLIC_` variable or browser bundle.
5. Restart only the analytics/query service that owns this connection pool.

The script is idempotent for rotation. It enforces `NOINHERIT`, `NOBYPASSRLS`, read-only transactions, a two-second statement timeout, an `analytics`-only search path, and `SELECT` grants on reviewed views only. It aborts if the role can select outside the analytics schema or has any table write grant.

## Verification

Connect as the analytics login and verify:

```sql
SHOW default_transaction_read_only;
SHOW statement_timeout;
SHOW search_path;

SELECT count(*) FROM analytics.eligible_match;
SELECT count(*) FROM analytics.player_edition_summary;

-- Both statements must fail.
SELECT count(*) FROM public."Match";
DELETE FROM analytics.ranking_snapshot WHERE false;
```

Run query-plan checks with known fixture IDs:

```bash
psql "$ANALYTICS_DATABASE_URL" \
  --set=competition_id='COMPETITION_ID' \
  --set=player_id='PLAYER_ID' \
  --set=position='GA' \
  --file scripts/check-analytics-query-plans.sql
```

Record execution time, buffers, and row estimates. Add materialized views only after these plans show a measured need.

## Rotation and rollback

- Rotate by re-running the provisioning script with a new secret, updating the deployment secret, and restarting the analytics connection pool.
- Revoke immediately with `ALTER ROLE centrepass_analytics NOLOGIN;` if the credential is suspected to be exposed.
- Analytics routes can be disabled without removing snapshots, record history, or invalidation state.

References: [Supabase Row Level Security and views](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Supabase custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas).
