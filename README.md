# CentrePass

Live scores, box scores, standings, fixtures, team profiles, and player profiles for the Suncorp Super Netball league.

**Live at [centrepass.io](https://centrepass.io)**

## Tech Stack

- **Framework:** Next.js 16 (App Router) with custom Express server
- **Runtime:** Node.js 24.14.1 on Render
- **Language:** TypeScript
- **Styling:** Tailwind CSS 4
- **Database:** Supabase PostgreSQL via Prisma 6.x
- **Real-time:** Socket.io (live scores + stats)
- **Auth:** NextAuth.js
- **Hosting:** Render (Oregon region)
- **Testing:** Vitest

## Data Sources

- **Champion Data** — Match fixtures, scores, and player statistics (free JSON endpoints)
- **TheSportsDB** — Team badges, player photos, and biographies

## Getting Started

```bash
# Install dependencies
npm install

# Push schema to database
npx prisma db push

# Seed with real SSN data
npx tsx prisma/seed.ts

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The background polling worker is disabled unless `WORKER_ENABLED=true` is set.
A normal development start therefore serves the application without polling
Champion Data or writing live updates.

### Safe worktree development

Use a unique port and a disposable local/test database for every worktree. Do
not copy the production database URL into a feature worktree.

```bash
PORT=3101 NEXTAUTH_URL=http://localhost:3101 npm run dev
```

Set both `DATABASE_URL` and `DIRECT_URL` to the worktree's disposable database,
and mark it with `DATABASE_ENVIRONMENT=local` (or `development`, `test`, or
`staging`). Keep `WORKER_ENABLED=false` unless that worktree specifically owns
polling. A non-production worker marked against `DATABASE_ENVIRONMENT=production`
will refuse to start unless `ALLOW_SHARED_PRODUCTION_DB_WRITES=true` is also set;
that acknowledgement is exceptional and should not be used for ordinary
development.

### Deterministic statistical queries

`POST /api/stats/query` accepts `{ "question": "..." }` and converts supported
netball questions into the finite `QuerySpecV1` contract. It never executes SQL
generated from user text. The endpoint requires `STATS_RATE_LIMIT_SECRET` in
production; only daily-rotating HMAC client keys and one-way question hashes are
stored in private analytics telemetry.

The application timeout limits the HTTP request but does not cancel an already
running database statement. Production must therefore retain the analytics
database role's two-second `statement_timeout` as the database-side backstop.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (with hot reload) |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm test` | Run tests |
| `npm run db:push` | Push Prisma schema to database |
| `npm run db:seed` | Seed database with real API data |
| `npm run db:studio` | Open Prisma Studio |

## Live Game Simulation

A dev-only simulation system lets you test the live scores pipeline without waiting for a real match.

```bash
# 1. Enable simulation in .env
SIMULATION_MODE=true
WORKER_ENABLED=true
DATABASE_ENVIRONMENT=local

# 2. Start dev server
npm run dev

# 3. Open admin panel
# http://localhost:3000/admin/sim
```

The simulation creates temporary matches (round 99), generates realistic scoring data through the real worker pipeline, and broadcasts via Socket.io. Orphaned data is auto-cleaned on startup.

Simulation still uses the same polling worker as live ingestion, so both
`SIMULATION_MODE=true` and `WORKER_ENABLED=true` are required. Run it only with
a disposable database marked `DATABASE_ENVIRONMENT=local`, `development`, or
`test`; staging and production are always rejected, even when shared production
writes were explicitly acknowledged. If the worker is disabled, simulation
routes and startup cleanup remain disabled as well, so a normal development
start performs no simulation writes.

**Production safeguards:** Simulation is blocked in production at three levels — server routes refuse to mount, the engine refuses to create matches, and the Champion Data client refuses to redirect to sim endpoints.

## Project Structure

```
src/
  app/              # Next.js App Router pages
  components/       # React components (ui/, player/, match/)
  lib/              # Server utilities (db, worker, simulation, etc.)
  types/            # TypeScript type definitions
prisma/
  schema.prisma     # Database schema
  seed.ts           # Real data seeder
server.ts           # Custom Express + Socket.io server
scripts/            # Maintenance scripts
stitch-designs/     # UI design prototypes (HTML + screenshots)
docs/               # Design specs and implementation plans
```
