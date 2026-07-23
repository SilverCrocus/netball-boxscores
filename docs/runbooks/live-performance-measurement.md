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
`server_phase_timing` events. Phase durations are wall-clock durations. The
candidate reads run in parallel, so phase/query duration sums are not a
critical-path measurement. Use the total operation duration for the route
latency and the phase events for attribution.

## Sample method

1. Record the deployed release SHA, service topology, route, date/time, and
   cache state.
2. Run a sequential cold or cache-cleared probe only when the environment
   explicitly permits it. Do not clear production caches casually.
3. Run a sequential warm probe with at least 20 valid samples per route and
   phase/query group.
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
npm run summarize:server-timing -- --file ./live-server-timing.jsonl
```

Use `--min-samples N` only when the evidence packet documents why a different
threshold is appropriate. Quantiles use a deterministic nearest-rank rule.
The output reports route/operation, named phase, and named query counts with
p50, p95, and `sufficientSamples`. Invalid structured lines are reported and
cause the command to exit non-zero; unrelated structured events are counted as
ignored. When operation events contain the request-local phase map, the
`phaseCoverage` section reports p50/p95 wall-clock coverage and the percentage
of samples at or above the 95% explainability threshold.

## Acceptance evidence

For Phase 4, verify that at least 95% of normal successful `/live` server
render time is accounted for by named phases, allowing framework/network time
outside the measured operation and accounting for overlap correctly.

For Phase 5, report p50 and p95 separately. The primary target is `/live` p95
under 2.0 seconds on the same production-class topology, or at least 40% below
the exact comparable baseline when topology/network floors make 2.0 seconds
unattainable. Also report that `/api/live-status` has not materially regressed
from its directional baseline near 1 second. Do not mark the gate met from
local tests or an undeployed branch.

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
