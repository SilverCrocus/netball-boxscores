# Wave 2 security, CI, and performance audit

Audit date: 2026-07-17
Baseline: `883ce77ce0539b8c40fb14820017c33350bc48e1` (`codex/wave1-integration`)

This audit was local and read-only outside GitHub repository metadata. It did
not connect to or mutate Supabase, Render, production URLs, hosted databases,
auth accounts, or deployment services. Local probes used localhost and
placeholder credentials only.

## Remediated findings

### Blocker

- The checked-in custom launcher imported Socket.IO and worker dependencies
  before `next().prepare()`. Their transitive Next server-only imports reached
  AsyncLocalStorage before Next initialized it, so `npm run dev` and the Render
  start command exited before binding. Socket and worker modules now load only
  after preparation. CI runs the built application through the exact custom
  launcher and requires `/api/health` to succeed on localhost.

### High

- Authenticated saved-resource endpoints accepted arbitrary match/team IDs and
  returned related records without reapplying public-edition and published-stage
  policy. This enabled an object-level authorization bypass for DRAFT match
  metadata. GET, POST, and team-follow behavior now filter through the public
  access policy, reject private IDs as not found, cap each resource type at 100,
  and use private `no-store` responses. The personalized home feed applies the
  same team predicate in its database query and revalidates the bounded result,
  so stale private associations cannot expose team IDs or metadata.

### Medium

- Signup and credentials login lacked abuse bounds. Mutations now enforce
  same-origin requests, bounded JSON objects, fixed-window limits, normalized
  identifiers, bounded field lengths, and generic existing-account behavior.
  Unknown credentials perform a dummy password comparison to reduce timing
  differences. Google OAuth is registered only when both required values exist,
  and redirects are restricted to the configured origin.
- Runtime configuration was validated piecemeal. Startup now rejects malformed
  boolean switches, production auth/database values, partial OAuth setup,
  analytics/Ask CentrePass dependency violations, unsafe production simulation,
  invalid preview allowlists, and insecure production upstream origins.
- Champion Data, TheSportsDB, and localhost preview fetches had unbounded
  response reads; the first two also lacked request deadlines. All now have
  request timeouts, response-size limits, bounded error messages, and existing
  cache behavior preserved.
- Signal handling used separate unbounded HTTP-only shutdown paths. SIGTERM,
  SIGINT, and required-worker failure now share one idempotent path that stops
  polling, stops accepting HTTP work, disconnects Socket.IO clients, closes both
  servers, and forces a non-zero exit if shutdown exceeds five seconds.
- Public search, today's matches, and the private followed-team feed performed
  per-match access lookups. They now use bounded batch authorization queries;
  candidate sets are capped at 5, 64, and 96 matches respectively. Team lists
  are capped at 256 and use a short shared-cache lifetime.
- The dependency tree included the PostCSS path traversal advisory
  (GHSA-qx2v-qp2m-jg93), UUID buffer validation advisory
  (GHSA-w5hq-g745-h8pq), and cookie out-of-bounds advisory
  (GHSA-pxg6-pf52-xh8x). Narrow lockfile overrides move only those transitive
  packages to patched versions. No direct framework, auth, Prisma, or tooling
  major upgrade was taken. Production and complete `npm audit` results are zero.

### Low

- CI used mutable Node 20 action tags and retained checkout credentials. The
  official Node 24 `checkout` and `setup-node` v7 actions are pinned to immutable
  commits, and checkout credentials are disabled. The production dependency gate
  now fails on moderate findings.
- A tracked Playwright console log and screenshot were generated QA evidence,
  not application inputs. Both were removed; precise ignore rules now cover the
  Playwright directory and the historical root-level `live-page-working.png`
  without hiding legitimate application images.
- Selected API and server errors could log URLs or credential-like values.
  New logs in this lane use bounded redaction, with direct tests for URL
  credentials and common secret assignments.

## Verified controls

- Ask CentrePass remains deterministic and rule-based. There is no LLM client or
  fallback. Input is capped at 300 characters, the request body at 1 KiB,
  compiler inputs use metric/aggregation/entity allowlists, results are capped
  at 100, SQL roles are scoped read-only/operations-only, database statement
  timeout is at most two seconds, and disabled/clarification/rejection/rate-limit
  states are explicit.
- Analytics and Ask CentrePass switches fail closed. Ask requires analytics,
  scoped database URLs, and a non-placeholder rate-limit secret. The Glasgow
  DRAFT preview requires an exact enable switch and a server-side operator
  allowlist; neither is exposed as a `NEXT_PUBLIC_` value.
- Personalized APIs are dynamic and private `no-store`; liveness/readiness and
  error responses are `no-store`. Public team metadata alone receives shared
  caching. Search and match endpoints bound query and result sizes.
- `/api/health` is process liveness and does not depend on the database.
  `/api/readiness` separately checks database, worker, scoped roles, privileges,
  and statement-timeout contracts. This avoids restart loops during dependency
  incidents while still providing a deployment/readiness gate.
- The worker uses a single recursive timeout and clears it on shutdown. Socket
  reconnects re-resolve public access instead of retaining publication access.
  Real launcher smoke coverage holds an active Socket.IO client through SIGTERM
  and separately verifies development SIGINT shutdown.

## Remaining risks and ownership

- GitHub reported no branch protection and no repository rulesets for
  `codex/wave1-integration` on the audit date. Repository administrators should
  require the `Check and build` job and review before integration. This is an
  external governance change and was not mutated by this lane.
- The Task D-owned Glasgow preview job has no protected GitHub environment and
  shares the workflow-level cancel-in-progress concurrency group. Concurrent or
  superseding manual rehearsals therefore need a Task D decision about a
  preview-specific non-cancelling concurrency key and environment approval.
  Database rehearsal commands and guards were not edited here.
- The CSP still permits inline scripts for current Next compatibility. A nonce-
  based strict CSP needs a separate rendering/cache change and browser coverage.
- Processing paths outside this lane still log raw caught errors. Worker error
  sinks owned here now use `safeErrorMessage`; remaining processing sinks should
  adopt the same policy in the data lane after confirming diagnostics remain
  sufficient.
- General auth/signup limiting is process-local. It bounds a single Render
  instance and caps memory at 10,000 keys, but a future multi-instance service
  should use a shared limiter. Ask CentrePass already uses its durable database
  limiter.
- Parser-context construction still performs several bounded directory queries
  per Ask CentrePass request. It is protected by rate limits and query timeouts;
  a short invalidatable cache is the next worthwhile optimization if production
  traces show this is material.
- Major upgrades shown by `npm outdated` (including Prisma, TypeScript, and
  ESLint) were intentionally deferred because they are broad compatibility work,
  not required security remediation.
