# CentrePass Phase 4-5 Live Performance Plan

## Decision

Phase 4 adds low-cardinality attribution for the Live server render. Phase 5
reduces the no-live fallback data shape and removes the full public competition
directory from that critical path. Both phases keep the existing publication,
access, capability, and freshness policy as the authority.

This work does not enable Cache Components, add a materialized view, create a
persistent read model, add a database index, change `/api/live-status`, or
cache changing live state.

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
It now also includes request-local `attributedDurationMs`, the interval-union
wall duration covered by named phases, and `phaseOverlapDurationMs` as a
diagnostic. The phase-duration map and separate phase events remain useful for
per-phase p50/p95, but their durations must not be added as if they were a
single critical path when phases are concurrent. The summarizer's coverage
gate uses the operation-level union field and rejects missing, invalid, or
impossible coverage. No URLs, arguments, SQL, IDs, payloads, credentials, or
user data are emitted.

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
therefore one bounded competition-page read plus two parallel candidate
queries. Pathological pages add only the same narrow, bounded read shape while
earlier pages contain no ready edition; the transaction keeps those pages on
one snapshot. If no public competition is ready, candidate reads are skipped
and the existing empty-card behavior is rendered. The active/live query,
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
- Phase 5 (this PR): bounded no-live fallback query-path reduction. Gate: a
  deployed exact-head sample shows `/live` p95 below 2.0s or at least 40%
  below a comparable topology baseline, with p50/p95 and sample metadata
  reported separately. This PR has not been production-deployed and cannot
  claim that gate from a non-production preview.
- Phase 6: measured Standings read-model or query work only after exact
  attribution and safe invalidation evidence.
- Phase 7: route transitions, prefetching, loading boundaries, and navigation
  UX after client/server traces identify a real transition bottleneck.
- Optional Phase 8: a gated Rust/WASM proof of concept only if production
  profiles show a specific CPU-bound pure function dominating after database
  and network work. Entry requires a stable benchmark corpus; exit should
  require at least a 20% request-level improvement with no correctness or
  operational regression.

Each later phase requires a captured exact release SHA, warm/cold state,
sequential and controlled low-concurrency samples, route/query/phase p50 and
p95, error/health results, and a rollback path before deployment.

## Rust decision

Rust or WASM does not address the currently observed dominant database,
network, RSC, and server-render latency. Adding FFI and deployment complexity
now would not be an evidence-backed page-loading fix. Continue with
TypeScript/Next.js/Postgres through Phases 4-7. Rust remains an optional Phase
8 experiment under the CPU-profile and end-to-end gates above. This PR adds no
Rust code or dependency.

## Rollback and release evidence

Phase 5 can be rolled back by restoring the Live page to the prior full
directory resolver; no database rollback is involved. If the deployed exact
head does not meet the measured gate, keep the PR unmerged and retain the
attribution logs for diagnosis. A rollout should start with sequential warm
requests, then a controlled low-concurrency probe while watching health,
readiness, errors, and resource metrics. Do not use a handful of curl samples
as a production p95 claim.

No production database, deployment, or data mutation was performed for this
PR.
