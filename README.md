# CentrePass

Live scores, box scores, standings, fixtures, team profiles, and player profiles for the Suncorp Super Netball league.

**Live at [centrepass.io](https://centrepass.io)**

## Tech Stack

- **Framework:** Next.js 15 (App Router) with custom Express server
- **Language:** TypeScript
- **Styling:** Tailwind CSS 4
- **Database:** Supabase PostgreSQL via Prisma 6.x
- **Real-time:** Socket.io (live scores + stats)
- **Auth:** NextAuth.js
- **Hosting:** Render (Sydney region)
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

# 2. Start dev server
npm run dev

# 3. Open admin panel
# http://localhost:3000/admin/sim
```

The simulation creates temporary matches (round 99), generates realistic scoring data through the real worker pipeline, and broadcasts via Socket.io. Orphaned data is auto-cleaned on startup.

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
