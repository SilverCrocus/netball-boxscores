# CentrePass

CentrePass is a multi-competition netball results application for live scores,
fixtures, results, standings, brackets, teams, players, rankings, records, and
deterministic statistical questions.

Production: [www.centrepass.io](https://www.centrepass.io)

## Current stack

- Next.js 16.2.11 App Router and React 19
- Custom Express 5 server with Socket.IO 4
- Node.js 24.14.1
- Supabase PostgreSQL through Prisma 6.19.3
- NextAuth 4
- Tailwind CSS 4
- Render Starter in Oregon
- Vitest, Testing Library, production smoke checks, and Playwright monitoring

See [the architecture overview](docs/architecture.md) for the current domain,
data flow, security boundaries, route groups, and sources of truth.

## Local development

Requirements:

- Node.js 24
- a disposable local PostgreSQL database

```sh
cp .env.example .env
npm ci
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Seeding is optional and
must be used only with a disposable local database.

Keep these safe defaults:

```dotenv
DATABASE_ENVIRONMENT=local
WORKER_ENABLED=false
ALLOW_SHARED_PRODUCTION_DB_WRITES=false
ANALYTICS_FEATURES_ENABLED=false
ASK_CENTREPASS_ENABLED=false
```

Never copy production or shared database credentials into a feature worktree.
Give each worktree its own database, port, and matching `NEXTAUTH_URL`:

```sh
PORT=3101 NEXTAUTH_URL=http://localhost:3101 npm run dev
```

When a local database is temporarily unavailable, localhost can use the
read-only hosted score API for supported public views:

```dotenv
CENTREPASS_PREVIEW_DATA_MODE=upstream
CENTREPASS_UPSTREAM_ORIGIN=https://www.centrepass.io
```

This mode is ignored in production and is not a substitute for database-backed
development or migration testing.

## Everyday commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Generate Prisma Client and build the production application |
| `npm start` | Start the production server locally |
| `npm run check` | Run lint, type checking, and the full test suite |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript without emitting files |
| `npm test` | Run Vitest once |
| `npm run smoke:server-startup` | Verify production server startup behavior |
| `npm run smoke:production` | Run the governed, read-only production smoke suite |
| `npm run monitor:navigation` | Measure public navigation in a sequential browser journey |
| `npm run summarize:server-timing` | Summarize bounded server-timing JSONL evidence |
| `npm run db:migrate:deploy` | Run the guarded Prisma migration deploy flow |
| `npm run db:seed` | Seed a disposable local database |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:push` | Push schema only to a disposable local database |

Production smoke, import, publication, and database commands have additional
target and evidence requirements. Follow the relevant runbook rather than
running them from this table alone.

## Live simulation

The development-only simulator exercises the real ingestion, database, and
Socket.IO pipeline without waiting for a live match.

Use it only with a disposable database:

```dotenv
DATABASE_ENVIRONMENT=local
SIMULATION_MODE=true
WORKER_ENABLED=true
ALLOW_SHARED_PRODUCTION_DB_WRITES=false
```

Start the server and open
[http://localhost:3000/admin/sim](http://localhost:3000/admin/sim). Production
and staging are rejected, and normal development remains write-free in the
background because the worker is disabled by default.

## Data and query boundaries

- Champion Data is the primary fixture, result, and live-stat source.
- TheSportsDB may enrich team and player media or biography fields.
- Governed competition imports preserve source, mapping, validation, receipt,
  checksum, and coverage evidence.
- Missing capability data stays unavailable; it is never represented as zero.
- `POST /api/stats/query` parses supported questions into the finite
  `QuerySpecV1` contract. It never executes SQL generated from user text.

## Documentation

Start at [docs/README.md](docs/README.md):

- [Architecture](docs/architecture.md)
- [Performance status and roadmap](docs/performance.md)
- [Production release runbook](docs/runbooks/production-release.md)
- [Production monitoring](docs/runbooks/production-monitoring.md)
- [Navigation performance monitoring](docs/runbooks/navigation-performance-monitoring.md)

Files under `docs/history/` are point-in-time evidence, not current operating
instructions. The code, Prisma migrations, `render.yaml`, workflows, and live
health/readiness responses take precedence if documentation drifts.

## Repository map

```text
src/app/          Next.js pages and route handlers
src/components/   Shared application UI
src/lib/          Data access, policy, worker, analytics, and runtime modules
prisma/           Schema, migrations, and seed data
scripts/          Verification, monitoring, import, and maintenance tools
docs/             Current architecture, performance, and operational guidance
server.ts         Express, Next.js, Socket.IO, and worker launcher
render.yaml       Production service contract
```
