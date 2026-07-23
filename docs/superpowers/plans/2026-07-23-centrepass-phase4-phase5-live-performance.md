# CentrePass Phase 4-7 Live Performance Plan

## Decision

Phase 4 adds low-cardinality attribution for the Live server render. Phase 5
reduces the no-live fallback data shape and removes the full public competition
directory from that critical path. Both phases keep the existing publication,
access, capability, and freshness policy as the authority.

This work does not enable Cache Components, add a materialized view, create a
persistent read model, add a database index, change `/api/live-status`, or
cache changing live state.

Phase 7 keeps navigation as a client-only concern. It changes when Next is
allowed to prefetch analytics and low-value navigation destinations, not what
any route loads or how freshness and publication are evaluated.

## Phase 6 standings baseline and decision

Phase 6 targets the two materially different standings routes at release
`a4a6ff4485a42caabab13efffde41d3be896c53a`. The measurements below are formal
warm sequential baselines: 20 full-body requests, concurrency 1, one warmup
excluded.

| Route | Response | TTFB p50 / p95 | Total p50 / p95 |
| --- | ---: | ---: | ---: |
| `/standings?edition=glasgow-2026` (legacy `Standing`, no table) | 36,226 bytes, all 200 | 22.713ms / 24.463ms | 1082.535ms / 1157.048ms |
| `/competitions/commonwealth-games-netball/glasgow-2026/standings` (`StageStanding`, pool tables) | 98,760 bytes, all 200 | 21.530ms / 28.249ms | 1183.056ms / 1371.686ms |

Separate `pg_stat_statements` windows for the canonical route recorded two
application statements per request: the fresh joined edition/readiness
projection used approximately 1.47–2.07ms of PostgreSQL execution, and the
joined Stage/StageGroup/EditionEntry/Team/StageStanding read used approximately
0.41–0.43ms. The roughly 1.1s completed-render cost is therefore primarily
round-trip/application latency, not PostgreSQL execution. Statement counts in
this plan refer to executed PostgreSQL statements, not logical Prisma calls;
nested relation loading can expand one logical call, so production evidence
must capture both explicitly.

Phase 6 keeps the fresh publication/readiness gate in front of the canonical
standings cache. The cached pool projection uses the versioned
`tournament_standings` namespace, `revalidate: 60`, and the `standings` tag.
This is Next's stale-while-revalidate guidance, not a hard TTL or a maximum
staleness guarantee: after the threshold Next may serve the current value while
refreshing in the background, and a failed refresh can leave that value stale
longer while retries continue. The fresh `resolveEdition()` gate still runs
before cache access and rejects unpublishing, identity changes, or readiness
revocation. Pre-event rows retain null standings and deterministic seed order;
zeros are never fabricated. Production remeasurement must exercise cold, warm,
post-threshold stale/background-refresh, and refresh-failure behavior when it
is observable; this PR does not claim a strict content-freshness bound.

The legacy fresh selector retains request-only React memoization between
`generateMetadata` and the page, but its `cache:false` loader now uses one
joined, route-shaped projection. It carries exact scalar counts and at most
five ordered stage-evidence rows and 39 ordered match-evidence rows (the
Glasgow contract plus one observable overflow row). Glasgow still requires
exactly 12 teams, 38 matches, 76 slots, four expected published stages, and a
clean applied import. Scalar counts and the overflow row make missing,
unexpected, unpublished, or +1 evidence fail closed; generic editions retain
their existing minimum gates even when larger than Glasgow.

## Phase 7 navigation intent-prefetch contract

The measured production baseline at exact deployed main
`42031ec32ba025d7d33c1560d83f1a3cf03bc409` used five click-to-new-heading
samples per edge after warmup:

| Transition | p50 | p95 |
| --- | ---: | ---: |
| Records -> Rankings | 1.383s | 1.764s |
| Rankings -> canonical Glasgow Standings | 0.018s | 0.020s |
| Standings -> Live | 1.806s | 1.845s |
| Live -> Records | 1.269s | 1.662s |

The initial Records render eagerly prefetched most sidebar destinations,
often twice. Records -> Rankings also produced unnecessary auth/sign-in and
rankings-subview RSC traffic. Phase 7 addresses that request amplification
without changing route loaders, database queries, cache TTLs, publication
checks, or URL construction.

`src/lib/navigation.ts` defines two explicit policies: `off` and
`intent-full`; an absent policy preserves Next's default. Only the exact
`/rankings` and `/records` sidebar/bottom-nav destinations use `intent-full`,
and those links begin with `prefetch={false}`. The native Next `Link` wrapper
enables `prefetch={true}` only after pointer/mouse entry, keyboard focus, or
touch start. The low-value Teams, Compare, and Ask/Explore destinations use
`off`; other Sidebar/BottomNav destinations remain ordinary native Next links
with default automatic/partial prefetch. Live and Standings never receive the
full-prefetch policy. Save-Data,
slow-2g, and 2g connections remain disabled; an unavailable connection API
also fails closed. Live remains request-time fresh and Standings retains its
fresh publication/readiness gate. Auth links and Rankings `view=players` /
`view=teams` tabs explicitly suppress automatic prefetch. Hrefs, modifier-key
behavior, active styling, pending announcements, accessibility, and
edition-aware canonical Standings links remain unchanged.

The production acceptance gate requires an exact deployed SHA, health/readiness
200, desktop 1440x900 and mobile 390x844 runs, one excluded warmup followed by
20 samples per transition, and no accessibility, console, hydration, or data
parity regressions. Records -> Rankings and Live -> Records must improve p95
by at least 25%; Standings and Live must regress by no more than 10%; navigation
acknowledgement p95 must remain below 150ms; initial navigation-prefetch
requests or bytes must fall by at least 40%; Save-Data/2G must produce zero
analytics prefetch before click; and no idle auth or rankings-subview prefetch
may occur. Local tests and a non-production build do not claim this gate.

### Phase 7 remeasurement and low-value traffic follow-up

The read-only production acceptance audit for merged PR #58 used the expected
release `eae37432c48f239fdf3a8305450611257b9aec54`; health and readiness stayed
200/ready. The first 20-sample table that clustered every transition around
three seconds was discarded as a measurement artifact after auditing the
timing helper. A fresh desktop observer measured the first target URL plus a
changed visible `main h1` with page `performance.now()` and no fixed
post-click wait:

| Transition | No-intent p50 / p95 |
| --- | ---: |
| Records -> Rankings | 1.733s / 1.796s |
| Rankings -> canonical Glasgow Standings | 0.768s / 0.824s |
| Standings -> Live | 1.975s / 2.061s |
| Live -> Records | 3.459s / 3.634s |

Keyboard-focus intent produced completed full prefetches, but the separate
click-to-heading p95 values were 1.588s for Records -> Rankings and 1.536s
for Live -> Records, so the analytics transition gates were still not met.
This audit does not claim Phase 7 acceptance.

A clean production Records load emitted 14 idle RSC prefetches totaling
26,822 encoded bytes. Teams accounted for 5,536 bytes, Ask/Explore 4,160,
Compare/players 3,797, canonical Standings 2,927, Live 3,754, competition
Home 2,904, and root 3,744. Rankings, Records, Auth, and rankings subview
prefetches were absent from the idle capture. The low-value traffic repair is
therefore deliberately limited to exact `/teams`, `/compare/players`, and
`/explore` links: disabling their viewport prefetch removes six requests and
13,493 bytes, a 42.9% request and 50.3% byte reduction. Root/Home, Live, and
canonical Standings retain ordinary default Next prefetch, while Rankings and
Records retain the existing intent-full policy. This is a traffic-only
follow-up; it changes no route, data, freshness, or publication behavior.

## Measured baseline

The available production observations at release `e42959f` are useful for
direction, but are not a statistically valid p50/p95 sample:

| Route | Observation | Timing |
| --- | --- | --- |
| `/live` | warm sequential request | about 4.303s total, 0.345s first byte |
| `/standings?edition=glasgow-2026` | warm sequential request | about 2.031s total |
| `/api/live-status` | warm sequential request | about 0.995s total |

The common no-live `/live` path previously showed approximately 0.56s for
`live_active_candidates`, 1.59s for the full `competition_directory`, 0.56s
for `live_latest_match`, and 1.77s for `live_next_match`, with additional
public-access policy work. These are small samples and should not be called a
p95. The route-level `queryDurationMs` field is a sum of query durations; it
can exceed wall-clock time when reads overlap.

Phase 4 measurements must capture the exact deployed release SHA, route,
cache state, concurrency, first-byte time, total time, and at least 20 valid
samples per reported group before treating p95 as decision-quality evidence.

## Phase 4 attribution

`measureServerPhase` records bounded wall-clock events with these stable names:

- `live-active-state`
- `live-fallback-competition`
- `live-fallback-candidates`
- `live-fallback-access-policy`

The existing `server_operation_timing` event remains the total server render.
It now also includes a low-cardinality `outcome` (`success` or `error`),
request-local `attributedDurationMs`, the interval-union wall duration covered
by named phases, and `phaseOverlapDurationMs` as a diagnostic. The
phase-duration map and separate phase events remain useful for per-phase
p50/p95, but their durations must not be added as if they were a single
critical path when phases are concurrent. The summarizer's coverage gate uses
only explicit-success operation events and the operation-level union field;
it rejects missing/unknown outcomes, nonpositive durations, missing coverage,
and impossible coverage. Error count is reported separately. No URLs,
arguments, SQL, IDs, payloads, credentials, or user data are emitted.

The summarizer streams CLI input and enforces 16 MiB/100,000-line/1 MiB-line
input caps plus 10,000 samples per group and 100,000 retained samples overall.
Its chunk-level byte scanner stops/destroys file or stdin input before an
oversized unterminated line is retained and decodes split UTF-8 only after a
bounded line completes. The normal one-live redirect is issued after the
measured handler succeeds, while genuine render failures remain error outcomes.

The context is request-local. Concurrent renders cannot contribute queries,
cache outcomes, or phase durations to one another. The JSONL summarizer reads
captured structured logs only; it never fetches production logs.

## Phase 5 call-graph change

Before:

1. Resolve active state and public access.
2. Resolve the full public competition directory, including unrelated labels,
   rulesets, coverage, and all directory candidates.
3. Read the next and latest candidates in parallel.
4. Reuse the selected full competition for public match access.

After:

1. Resolve active state and public access exactly as before.
2. On the no-live branch, read a bounded page of 32 published competition
   candidates using a route-shaped projection containing only identity,
   complete public readiness inputs, and edition-level capability coverage.
3. Select the newest candidate that passes the existing generic and strict
   Glasgow readiness function. A newer published but incomplete shell is
   skipped deterministically. If a complete page has no ready edition, a
   deterministic id cursor advances to the next bounded page inside one
   PostgreSQL `RepeatableRead` snapshot. There is no arbitrary overall cutoff,
   so an older ready edition remains visible even after more than 32 newer
   shells fail readiness.
4. Read one scheduled and one completed candidate in parallel, each bounded by
   `findFirst` and the existing public-stage/result predicates.
5. Reuse the selected policy projection in `resolvePublicMatchAccessBatch`,
   so no second edition-readiness query is needed.

When a public competition exists on the normal path, the fallback portion is
therefore one logical Prisma competition-page loader call plus two parallel
candidate queries. Nested relation loading can expand that logical page call
into multiple PostgreSQL statements depending on Prisma's strategy, so
production-class evidence must capture the actual SQL statement count.
Pathological pages add only the same narrow, bounded read shape while earlier
pages contain no ready edition; the transaction keeps those pages on one
snapshot. If no public competition is ready, candidate reads are skipped and
the existing empty-card behavior is rendered. The active/live query,
one-live redirect, multi-live chooser, no-store polling route, and all
score/capability fail-closed rules are unchanged.

## Correctness invariants

- `/live` remains force-dynamic and does not reuse a stale changing-score
  snapshot.
- The existing `getLiveState` public-access resolution remains authoritative.
- Generic publication requires a published edition, identity, minimum active
  entries, and minimum matches.
- Glasgow still requires exactly 12 teams, 38 matches, 76 match slots, a clean
  successful applied import, all expected stages, and published stages.
- Simulated matches, unpublished stages, unresolved teams, unavailable final
  scores, and unavailable super-shot data remain denied or redacted by the
  existing policy.
- Database and access failures remain fail-closed at the same boundaries.
- `/api/live-status` retains its bounded PostgreSQL `RepeatableRead` snapshot.

## Roadmap and gates

- Phase 4 (this PR): named attribution and reproducible p50/p95 summaries.
  Gate: at least 95% of normal successful `/live` server-render time is
  explainable by named phases, with overlap interpreted correctly.
- Phase 5a (the preceding implementation): bounded no-live fallback query-path
  reduction. Gate: a
  deployed exact-head sample shows `/live` p95 below 2.0s or at least 40%
  below a comparable topology baseline, with p50/p95 and sample metadata
  reported separately. This PR has not been production-deployed and cannot
  claim that gate from a non-production preview.
- Phase 5b (this PR): collapse relation round trips in the existing fresh Live
  query path with Prisma's PostgreSQL `relationLoadStrategy: 'join'`. The
  logical call shape and all policy boundaries remain unchanged. The gate is a
  real PostgreSQL 17 rehearsal that observes emitted Prisma query events,
  proves the cursor traversal still selects the older ready edition after 34
  newer unready shells, and proves query/join result parity. Production
  acceptance remains pending a deployed exact-head measurement.
- Phase 6 (this PR): cache canonical tournament pool standings behind the
  fresh edition/readiness gate and collapse the legacy fresh directory into
  one bounded joined projection. The PostgreSQL 17 rehearsal must prove
  projection parity for pre-event and populated pool tables, a clearly labeled
  JSON/cache emulation with one loader miss and zero warm pool-data reads,
  exact/adversarial Glasgow readiness, normalized legacy/fresh directory
  selection parity, and an actual directory statement reduction. That
  emulation does not prove Next `unstable_cache` or SWR behavior; actual
  production cache behavior is a mandatory deployment/remeasurement gate. The
  later deployed acceptance gate is zero
  HTTP errors with health/readiness 200, cached TTFB p50 below 500ms, warm
  full-response p95 below 1.5s, and at least 20% p95 improvement against both
  formal baselines (legacy <=925.638ms; canonical <=1097.349ms). Cold and
  post-threshold SWR responses are expected; production evidence must record
  whether the response was stale/background-refreshing and whether refresh
  failure was observable. This PR does not claim that deployed gate.
- Phase 7 (this PR): intent-scoped navigation prefetching. Only exact
  `/rankings` and `/records` links upgrade from `prefetch={false}` after
  pointer, focus, or touch intent; ordinary Live/Standings navigation keeps
  Next's default behavior. Gate: the exact deployed acceptance run above must
  meet its transition, acknowledgement, prefetch-volume, constrained-network,
  and accessibility/data-parity thresholds. Local and preview evidence cannot
  claim this production gate.
- Optional Phase 8: a gated Rust/WASM proof of concept only if production
  profiles show a specific CPU-bound pure function dominating after database
  and network work. Entry requires a stable benchmark corpus; exit should
  require at least a 20% request-level improvement with no correctness or
  operational regression.

Each later phase requires a captured exact release SHA, warm/cold state,
sequential and controlled low-concurrency samples, route/query/phase p50 and
p95, error/health results, and a rollback path before deployment.

## Phase 5b evidence and query-round-trip diagnosis

The exact production receipt for the previous Live optimization did not meet
the Phase 5a target: at release
`718f18b3b522f12bfbef42eea3f77cccb1c0a7d4`, 20 warm sequential `/live`
requests produced p50 `3841.1ms` and p95 `3939.0ms`. Compared with the prior
comparable p95 of `4101.5ms`, that is approximately 4.0% lower, not the
required 40% reduction and not below 2.0s. These measurements are production
evidence for the failed gate, not Phase 5b acceptance.

The corrected before/after `pg_stat_statements` snapshots for a stable warm
request show 14 application SQL statements and approximately `0.835ms`
combined PostgreSQL execution. A stream trace shows an approximately 3.65s
gap before the Live Suspense boundary. Together, these observations point to
Prisma/Supavisor relation round-trip fan-out rather than PostgreSQL execution
or application CPU as the dominant delay. The Phase 5b change therefore keeps
fresh reads and the existing logical fallback calls, but asks Prisma to use
PostgreSQL joins and JSON aggregation for the relation-bearing queries.

The loopback PostgreSQL 17 verifier uses a query-event Prisma client only for
the rehearsal and runs the same fixture/projection in both `query` and `join`
mode. It counts actual emitted query events, not unique SQL shapes; it excludes
transaction-control and isolation-probe events from the data-statement count,
and never logs raw SQL. The exact CI result for the 34-shell, two-page fixture
was 16 query events / 12 data statements in query mode versus 11 query events /
7 data statements in join mode, with identical selected IDs and serialized
results. Join emitted one statement containing `LATERAL` in that run. No
production or shared database is used by this proof. The exact emitted SQL
count remains a CI/rehearsal result, not an estimate from named application
timings; production-class evidence must capture the actual statement count on
the deployed topology.

The route-shaped projection bounds only child evidence needed by the strict
Glasgow policy: five ordered stage rows (four expected plus one overflow) and
39 ordered match rows (38 expected plus one overflow). Team/match/stage
aggregate counts remain scalar and exact, and each loaded match retains its
exact slot count. A real rehearsal fixture includes a published Glasgow
projection with 39 matches and 78 slots; it must be rejected while the older
generic edition remains selected. Generic editions retain their existing
minimum-count behavior even when they exceed Glasgow's shape. The verifier's
meaningful-reduction gate requires at least two statements and at least 25% of
query-mode data statements, rounded up; this is three for the observed
12-statement fixture, so 12-to-7 passes and 12-to-11 does not. The preceding
analytics epoch rehearsal leaves the canonical Glasgow seed at 12 teams, 37
matches, and 74 slots; the verifier requires and snapshots that exact seed,
adds only two namespaced matches, and verifies cleanup restores its scalar and
gate state without inserting or deleting the canonical series or edition.

## Rust decision

Rust or WASM does not address the currently observed dominant database,
network, RSC, and server-render latency. Adding FFI and deployment complexity
now would not be an evidence-backed page-loading fix. Continue with
TypeScript/Next.js/Postgres through Phases 4-7. Rust remains an optional Phase
8 experiment under the CPU-profile and end-to-end gates above. This PR adds no
Rust code or dependency.

## Rollback and release evidence

Phase 5b can be rolled back by removing the relation-join preview feature and
the `relationLoadStrategy: 'join'` options, restoring the prior query strategy;
no database rollback is involved. Phase 5 can be rolled back by restoring the Live page to the prior full
directory resolver; no database rollback is involved. Phase 7 is also a
code-only rollback: remove the intent wrapper and policy usage, restoring the
prior native navigation-link behavior; no data, cache, or schema rollback is
involved. If the deployed exact
head does not meet the measured gate, keep the PR unmerged and retain the
attribution logs for diagnosis. A rollout should start with sequential warm
requests, then a controlled low-concurrency probe while watching health,
readiness, errors, and resource metrics. Do not use a handful of curl samples
as a production p95 claim.

No production database, deployment, or data mutation was performed for this
PR.
