# CentrePass repository guidance

CentrePass is a multi-competition netball results application. Read
[`AGENTS.md`](AGENTS.md) first, then use [`docs/README.md`](docs/README.md) as
the documentation index.

## Current system

- Next.js 16.2.11 App Router and React 19
- Express 5, Socket.IO 4, and Node.js 24.14.1
- Supabase PostgreSQL through Prisma 6.19.3
- NextAuth 4 and Tailwind CSS 4
- Render Starter service in Oregon

Do not maintain a second file-by-file architecture catalogue here. The current
domain, runtime flow, routes, security boundaries, and sources of truth are in
[`docs/architecture.md`](docs/architecture.md). Performance status and decision
gates are in [`docs/performance.md`](docs/performance.md).

## Safety boundaries

- Preserve unrelated work in a dirty checkout. Use an isolated worktree for
  changes that overlap existing edits.
- Never use production or shared database credentials for ordinary
  development, tests, simulation, rehearsals, or previews.
- Keep `WORKER_ENABLED=false`, `SIMULATION_MODE=false`,
  `ALLOW_SHARED_PRODUCTION_DB_WRITES=false`,
  `ANALYTICS_FEATURES_ENABLED=false`, and
  `ASK_CENTREPASS_ENABLED=false` unless the task explicitly owns that bounded
  behavior.
- Treat imports, migrations, publication, production feature enablement,
  deploys, and rollback as governed actions. Follow the current runbook and
  require an exact target plus the documented approval/evidence.
- Do not commit, push, merge, deploy, publish, or mutate a hosted service unless
  the request authorizes that action.
- Never put credentials, connection strings, cookies, raw user identifiers,
  natural-language questions, SQL, or sensitive response bodies in logs or
  evidence.
- Missing or unsupported capability data is unavailable, not zero.

## Data and access invariants

- Public competition data is gated by publication, visibility, import,
  topology, and capability policy. A slug match alone is never enough.
- Live state stays request-fresh and fail-closed.
- Cached tournament and analytics reads remain behind fresh public-access and
  readiness checks.
- Ask CentrePass parses text into the finite `QuerySpecV1` contract. It does
  not generate SQL from user text and has no LLM fallback.
- Analytics and stats operations use separate least-privilege database roles.
  Do not substitute `DATABASE_URL` or `DIRECT_URL`.
- Simulation must use a disposable local database and requires both
  `SIMULATION_MODE=true` and `WORKER_ENABLED=true`.

## Verification

Use the smallest relevant check while developing, then run the full gate before
hand-off:

```sh
npm run check
npm run build
```

Other current commands:

```sh
npm run smoke:server-startup
npm run smoke:production
npm run monitor:navigation
npm run summarize:server-timing
npm run db:migrate:deploy
```

Production smoke and database commands need the additional arguments and
guards in [`docs/runbooks/`](docs/runbooks/). A passing local test or preview
does not establish production acceptance.

## Git and documentation

- Git operations are allowed when requested.
- Fix branches use `hotfix/` or `bugfix/` prefixes.
- Keep commits focused and do not force-push `main`.
- Surface destructive or irreversible actions before running them.
- Do not add Codex attribution or generated-by footers to commits or pull
  requests.
- Files under `docs/history/` are immutable evidence snapshots, not current
  instructions.
- Remove completed one-off plans instead of letting them become a competing
  source of truth; Git history retains them.
- After code or documentation changes, run `graphify update .`. Generated
  `graphify-out/` files stay out of feature changes unless explicitly required.

## Source systems

- Champion Data is the primary SSN fixture, result, and live-stat source.
- TheSportsDB is optional enrichment for media and biography fields.
- Glasgow and other governed imports must preserve source, mapping, validation,
  receipt, checksum, and coverage evidence.

When prose disagrees with the repository, verify the implementation. Dependency
versions come from `package.json`; deployment topology from `render.yaml`;
database shape from `prisma/schema.prisma` and migrations; routes from
`src/app/`; and live production state from the exact release, health,
readiness, Render, and Supabase evidence.
