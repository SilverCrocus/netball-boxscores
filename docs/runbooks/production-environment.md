# CentrePass production environment matrix

The checked-in Render Blueprint defines a Node 24.14.1 `centrepass` web service
in Oregon. Secrets are supplied by Render/Supabase and must never be committed,
printed, pasted into tickets, or exposed through `NEXT_PUBLIC_` variables.

There is no `ANALYTICS_TELEMETRY_DATABASE_URL` in the application. The actual
narrow telemetry/rate-limit credential is `STATS_OPERATIONS_DATABASE_URL`.

| Variable | Production contract | Secret | Owner / rotation |
| --- | --- | ---: | --- |
| `NODE_ENV` | `production` (Blueprint) | no | application owner; deploy change |
| `NODE_VERSION` | `24.14.1` (Blueprint) | no | application owner; reviewed upgrade |
| `DATABASE_ENVIRONMENT` | `production`; worker safety identity | no | application owner; never relax in prod |
| `DATABASE_URL` | general Prisma runtime URL; production Supabase pooler; write-capable server only | yes | database owner; rotate on exposure/standard cycle |
| `DIRECT_URL` | production direct/session-mode URL used only by migrations/owner administration | yes | database owner; rotate with owner credential |
| `ANALYTICS_DATABASE_URL` | `centrepass_analytics` transaction-pooler URL; exact private-view SELECT allowlist, read-only, 2 s timeout | yes | analytics/database owner; provision/rotate via role runbook |
| `ANALYTICS_TELEMETRY_DATABASE_URL` | **not used; do not configure**. This name is absent from application and Blueprint code | n/a | replace any external reference with `STATS_OPERATIONS_DATABASE_URL` |
| `STATS_OPERATIONS_DATABASE_URL` | `centrepass_stats_operations` transaction-pooler URL; only two rate-limit/telemetry functions, no relation access | yes | analytics/database owner; provision/rotate separately |
| `STATS_RATE_LIMIT_SECRET` | independent non-placeholder random secret, minimum 32 characters; HMAC only | yes | security/application owner; independent rotation resets effective identities |
| `ANALYTICS_FEATURES_ENABLED` | kill switch; `false` until scoped role/readiness passes, `true` for production release | no | release owner; restart/deploy and verify readiness |
| `ASK_CENTREPASS_ENABLED` | narrower kill switch; requires analytics; `false` until operations role/secret pass | no | release owner; restart/deploy and verify readiness |
| `WORKER_ENABLED` | `true` in normal production; `false` only for documented containment | no | operations owner; readiness intentionally degrades while false |
| `ALLOW_SHARED_PRODUCTION_DB_WRITES` | `false` (or unset, which fails closed); prefer explicit `false` in production | no | operations owner; changing to true is prohibited without a separate reviewed incident plan |
| `NEXTAUTH_SECRET` | generated high-entropy NextAuth secret | yes | auth owner; rotate with forced session invalidation plan |
| `NEXTAUTH_URL` | exact public HTTPS origin | no | auth/release owner; verify after domain change |
| `GOOGLE_CLIENT_ID` | server OAuth client ID (treat as controlled config) | controlled | auth owner; provider rotation |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret | yes | auth owner; immediate rotation on exposure |
| `CHAMPION_DATA_BASE_URL` | optional checked source base; not a credential | no | data owner; provider review |
| `THESPORTSDB_API_KEY` | optional provider key | yes | data owner; provider rotation |
| `THESPORTSDB_BASE_URL` | provider base URL | no | data owner |

`CENTREPASS_PREVIEW_DATA_MODE` and `CENTREPASS_UPSTREAM_ORIGIN` are localhost
fallback controls and must not be enabled in production. `SIMULATION_MODE` must
not be used against production.

## Required invariants

- All four database URLs use an authentic Supabase direct/shared-pooler host,
  resolve uniquely to project ref `iqnhnlttvnvkwrqvnrna`, and reject preview
  ref `xpfdjkqrbvdasjpllxnc`; use the non-printing guard in
  [`production-release.md`](production-release.md).
- `DIRECT_URL` uses direct/session mode on port `5432`; `DATABASE_URL` uses
  transaction mode on port `6543`. The scoped analytics/operations URLs use
  the Supavisor transaction pooler on port `6543`; application code
  enforces their pool limits and timeout parameters.
- The four database roles/URLs are not interchangeable.
- Both feature flags fail closed. Ask cannot be enabled while analytics is off.
- Normal production is `WORKER_ENABLED=true`,
  `DATABASE_ENVIRONMENT=production`,
  `ALLOW_SHARED_PRODUCTION_DB_WRITES=false`.
- `/api/readiness` is the authoritative runtime probe for URL presence,
  database identities, exact grants, read-only status, statement timeouts,
  rate-limit secret and worker health.

## Provisioning and rotation

Follow [`analytics-readonly-role.md`](analytics-readonly-role.md) for scoped
roles and secret rotation. Inject credentials with the platform secret manager;
never use shell tracing, command-line URL arguments, committed `.env` files or
screenshots of secret fields. Record only project ref, role name, rotation time,
operator and readiness result.

After any environment change, capture the resulting Render deployment ID and
run health/readiness. Feature/worker procedures are in
[`production-release.md`](production-release.md) and
[`production-monitoring.md`](production-monitoring.md).

## Credential-safe owner access

Operational `psql` checks must never place a database URL or password in the
process argument list. Store two secret-file values in the approved secret
manager and materialize them into private temporary files for the release
session:

- a libpq service file containing a reviewed
  `[centrepass-production-direct]` service with the production direct/session
  host, port `5432`, database `postgres`, exact owner user and
  `sslmode=verify-full`; and
- a matching `pgpass` file containing exactly one non-wildcard credential row.

The service must be either the production direct endpoint with user `postgres`,
or the reviewed Supavisor session endpoint with user
`postgres.iqnhnlttvnvkwrqvnrna`. For the direct endpoint the non-secret service
shape is:

```ini
[centrepass-production-direct]
host=db.iqnhnlttvnvkwrqvnrna.supabase.co
port=5432
dbname=postgres
user=postgres
sslmode=verify-full
```

Do not add another section, duplicate a key, use `include`/`include_dir`, store
`password` in the service file, or add unreviewed libpq options. The sole
`pgpass` entry must match the selected host, port, database and user exactly.

The secret manager, not a shell heredoc or command history, must write the file
contents. Then set only these selectors:

```bash
set +x
umask 077
export PGSERVICE='centrepass-production-direct'
export PGSERVICEFILE='<ABSOLUTE_PRIVATE_PATH_FROM_SECRET_MANAGER>/pg_service.conf'
export PGPASSFILE='<ABSOLUTE_PRIVATE_PATH_FROM_SECRET_MANAGER>/pgpass'
chmod 600 "$PGSERVICEFILE" "$PGPASSFILE"
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD
npm run guard:production-psql
```

The production verification scripts reject relative/permissive files and any
other `PG*` environment variable that could override the reviewed service,
including TLS/session options such as `PGSSLMODE`. Start from a clean release
shell and unset any additional `PG*` variable before verification. The guard
parses the exact selected service and matching password target without printing
credentials. Run it immediately before any approved direct `psql` invocation,
or use the checked-in verification scripts, which invoke the same guard.

`DATABASE_URL` and `DIRECT_URL` are still injected into the environment for
Prisma/importer use and the non-printing project-ref guard. They must both pass
`npm run guard:production-target` before an approved production mutation. The
libpq files must be removed by the secret-manager session lifecycle at the end
of the operation; do not archive them with release evidence. Never provide a
database URL as psql's positional connection argument.
