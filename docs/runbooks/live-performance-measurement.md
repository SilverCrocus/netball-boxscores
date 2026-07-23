# Live Performance Measurement Runbook

This runbook covers the low-cardinality server timing emitted by `/live` and
the evidence required before accepting a later performance phase.

## Capture contract

Capture structured JSONL lines for the exact release SHA under test. Keep the
route, operation, phase, query name, duration, cache state, cache state of the
request, concurrency, first-byte time, and total time. Do not capture or
forward URLs with query strings, request arguments, SQL, IDs, response bodies,
credentials, or user data.

The route emits one total `server_operation_timing` event and named
`server_phase_timing` events. Each operation has the low-cardinality outcome
`success` or `error`. Phase durations are wall-clock durations. The
candidate reads run in parallel, so phase/query duration sums are not a
critical-path measurement. The operation event's `attributedDurationMs` is the
union of the request-local named-phase intervals, clamped to the operation
duration; overlapping and nested phases are counted once. Its
`phaseOverlapDurationMs` field is diagnostic only. Use the total operation
duration for route latency, the operation-level union for the coverage gate,
and individual phase events for per-phase attribution.
The normal one-live `/live` redirect is resolved by the measured handler and
issued afterward, so that framework control-flow exception is not misclassified
as a failed render; real handler/query/render exceptions remain `error`.

## Sample method

1. Record the deployed release SHA, service topology, route, date/time, and
   cache state.
2. Run a sequential cold or cache-cleared probe only when the environment
   explicitly permits it. Do not clear production caches casually.
3. Run a sequential warm probe with at least 20 explicit-success samples per
   route and phase/query group. Record error count/rate separately; failed
   renders are not acceptance samples.
4. Run a separate controlled low-concurrency wave. Keep concurrency small
   enough to observe health, readiness, error rate, RSS/heap, and database
   pressure. Do not call this a load test.
5. Preserve first-byte and total timings separately. A fast first byte does
   not prove a fast completed render.
6. Compare only comparable topology, release, cache state, route, and
   concurrency. A few curl timings are directional observations, not a p50 or
   p95.

## Summarize captured JSONL

The summarizer reads stdin or an explicit local file and never contacts a
production service:

```sh
npm run summarize:server-timing -- --file ./live-server-timing.jsonl --require-coverage
```

Use `--min-samples N` only when the evidence packet documents why a different
threshold is appropriate. `--gate` remains a compatibility alias for
`--require-coverage`. Quantiles use a deterministic nearest-rank rule. The
output reports route/operation, named phase, and named query counts with p50,
p95, and `sufficientSamples`, plus explicit-success, error, and invalid-outcome
counts. Errors are reported separately and excluded from the success
denominator; missing or unknown outcomes are invalid for acceptance. In gate
mode, every successful operation sample must have a positive duration and
finite operation-level coverage within that duration, and every coverage group
must meet the configured sample threshold and 95% explainability rule. Legacy
events with no outcome or only the phase-duration map cannot satisfy the gate.
The `phaseCoverage` section reports p50/p95 union coverage and the percentage
of samples at or above the 95% explainability threshold; it never reconstructs
coverage by summing phases.

The CLI scans stdin/files in bounded byte chunks rather than using a line
reader that can retain an unterminated line. It counts total input and current
line bytes as chunks arrive, stops/destroys the source as soon as a cap is
crossed, and decodes UTF-8 only after a complete line is bounded. Input is
capped at 16 MiB and 100,000 lines, each line at 1 MiB, each group at 10,000
retained samples, and all retained samples at 100,000. Limit failures return a
stable reason without echoing log content.

One logical Prisma competition-page loader call is not necessarily one
PostgreSQL statement: nested relation loading can expand into multiple SQL
statements depending on Prisma's strategy. Production-class evidence must
capture the actual SQL statement count separately; the named timing event's
query count is not a substitute for that database-level count.

## Acceptance evidence

For Phase 4, verify that at least 95% of normal successful `/live` server
render time is accounted for by named phases, allowing framework/network time
outside the measured operation. Use the operation-level interval union, not a
sum of overlapping or nested phase durations, and require the summarizer's
`--require-coverage` result to be successful. Report error count/rate
separately from the successful-route p50/p95 and coverage denominator.

For Phase 5, report p50 and p95 separately. The primary target is `/live` p95
under 2.0 seconds on the same production-class topology, or at least 40% below
the exact comparable baseline when topology/network floors make 2.0 seconds
unattainable. Also report that `/api/live-status` has not materially regressed
from its directional baseline near 1 second. Do not mark the gate met from
local tests or a non-production preview.

## Phase 5b relation-round-trip evidence

The prior Phase 5 receipt at release
`718f18b3b522f12bfbef42eea3f77cccb1c0a7d4` was a failed gate: 20 warm
sequential `/live` requests measured p50 `3841.1ms` and p95 `3939.0ms`, only
about 4.0% below the comparable `4101.5ms` p95 and above both acceptance
thresholds. Separate before/after `pg_stat_statements` snapshots for a stable
warm request showed 14 application SQL statements and approximately `0.835ms`
combined PostgreSQL execution, while the stream trace showed an approximately
3.65s gap before the Live Suspense boundary. This points to Prisma/Supavisor
relation round-trip fan-out, not PostgreSQL execution time.

Phase 5b enables Prisma PostgreSQL `relationJoins` and passes
`relationLoadStrategy: 'join'` to the relation-heavy active/window, fallback
competition, and next/latest reads. It does not cache Live state, change the
logical query call shape, or relax publication/access/capability policy. The
PostgreSQL 17 rehearsal runs the same fallback fixture and projection twice,
once with Prisma's current `query` strategy and once with `join`, and observes
actual emitted Prisma query events. On the current Prisma 6.19.3/PostgreSQL 17
fixture, query mode emitted 16 query events / 12 data statements and join mode
emitted 11 query events / 7 data statements; both selected the same older ready
edition and produced identical serialized results. The count is executions,
not unique SQL shapes; transaction-control and isolation-probe events are
excluded from the data-statement total, and raw SQL is never logged. The
production-class statement count must still be captured after deployment; the
rehearsal result is not a promise that every relation becomes one statement.
Do not claim Phase 5 or 5b production acceptance until an exact deployed-head
p50/p95 sample proves the gate.

The Live fallback policy projection keeps generic aggregate gates exact as
scalar counts. For a Glasgow identity, it loads five ordered stage rows
(four contract rows plus one overflow row) and 39 ordered match rows (38 plus
one overflow row), while each loaded match retains its exact scalar slot count.
The strict readiness evaluator also receives the exact stage count. Therefore a
39th match, a fifth stage, or excess slots cannot be hidden by a child-array
limit; generic editions are not made false-unready because their larger arrays
are not used by the generic gate. The PostgreSQL rehearsal exercises this with
a non-empty published Glasgow edition containing 39 matches and verifies that
the older generic edition is still selected. Because the preceding analytics
epoch rehearsal intentionally leaves the canonical Glasgow seed in the
ephemeral database, this verifier requires that exact 12-team/37-match/74-slot
baseline, snapshots its scalar identity and gate counts, adds only two
namespaced matches, and proves cleanup restores the seed; it never inserts or
deletes the canonical series or edition.

The verifier requires a meaningful relation reduction, not merely any lower
number: at least two data statements and at least 25% of the observed query
mode count (rounded up). On the current 12-statement fixture this requires
three statements, so the observed 12-to-7 result passes while 12-to-11 fails.

## Phase 6 standings evidence

Use the exact release `a4a6ff4485a42caabab13efffde41d3be896c53a` baselines when
comparing the later canonical standings cache:

- Legacy `/standings?edition=glasgow-2026`: 20 warm sequential full-body
  samples, one warmup excluded, all 200 and 36,226 bytes; total p50
  1082.535ms and p95 1157.048ms.
- Canonical `/competitions/commonwealth-games-netball/glasgow-2026/standings`:
  the same method, all 200 and 98,760 bytes; total p50 1183.056ms and p95
  1371.686ms.

The later deployed acceptance thresholds are zero HTTP errors with
health/readiness 200, cached TTFB p50 below 500ms, warm full-response p95 below
1.5s, and at least 20% p95 improvement against both formal baselines: legacy
`<=925.638ms` and canonical `<=1097.349ms`. These are deployment gates, not
claims that local or preview measurements satisfy them.

The canonical route resolves the edition and its complete public readiness
freshly on every request before reading the `tournament_standings` cache. The
pool read uses `revalidate: 60` with the `standings` tag as Next's
stale-while-revalidate guidance, not as a hard TTL or maximum staleness bound.
After the threshold, a request may receive the current value immediately while
Next refreshes in the background; a failed refresh can leave that value stale
longer and be retried. A warm hit must produce no
`tournament_pool_standings_rows` query, while a miss produces one joined read.
Production evidence must separately exercise cold, warm, post-threshold
stale/background-refresh, and refresh-failure behavior when observable. The
fresh edition/readiness check still fails closed before cache access. StageStanding
rows are projected as published values when present and remain null in
pre-event seed order when absent. Never manufacture zero statistics.

The PostgreSQL rehearsal's miss/warm section is intentionally a JSON/cache
emulation of loader invocation and serialization parity; it is not a Next
`unstable_cache` or SWR proof. The production acceptance packet must use an
exact deployed build and real requests to verify cold, warm, post-threshold
stale/background-refresh, and observable refresh-failure behavior.

The legacy fresh selector is request-memoized so metadata and page rendering
share one result. Its `cache:false` path uses one joined, bounded projection:
five ordered stage-evidence rows and 39 ordered match-evidence rows, while
exact scalar counts remain authoritative. Glasgow readiness still requires
exactly 12 teams, 38 matches, 76 slots, four expected published stages, and a
clean applied import. An extra or unexpected stage/match/slot, a missing or
unpublished required stage, or a failed import remains fail-closed. Generic
editions retain their minimum gates even when their shape exceeds Glasgow.

Run the loopback-only PostgreSQL 17 proof in the CI lane (or against an
explicitly opted-in ephemeral local service):

```sh
CENTREPASS_EPHEMERAL_PG17_REHEARSAL=true \
  npm run verify:standings-postgres
```

The verifier counts emitted query executions, not unique SQL shapes, and never
prints SQL. It compares the actual two-logical-read legacy projection with the
one-statement fresh projection, checks at least one relation-join statement,
proves pre-event/populated serialized projection parity, and proves one cache
miss followed by a warm read with zero pool-data statements. It also adds and
removes only namespaced ephemeral child rows around the canonical Glasgow seed
to prove exact readiness and +1 overflow rejection. It must not be pointed at
preview, shared, or production credentials.

## Rollout and rollback

After deployment, begin with sequential warm checks for `/live`, then perform
only a controlled low-concurrency wave while watching health/readiness,
5xx/unhandled errors, database timings, and memory. Stop if the route or
resource metrics regress. The Phase 5 rollback is source-only: restore the
prior full-directory fallback resolver and redeploy the approved rollback
release. No schema or data rollback is required.

This PR's measurements are local/test evidence plus the supplied production
baseline. It performs no production mutation and does not claim production
acceptance.
