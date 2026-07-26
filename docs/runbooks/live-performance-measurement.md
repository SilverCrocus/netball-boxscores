# Live server and data performance measurement

Use this runbook to measure the server-side `/live` path and decide whether a
data-path change improved production performance. Browser route switching is a
separate concern covered by
[navigation performance monitoring](navigation-performance-monitoring.md).

## Evidence identity

Every evidence packet must record:

- exact deployed release SHA;
- route and operation;
- production-class topology;
- date/time and operator;
- cold, warm, or explicitly cleared cache state;
- sequential or controlled low concurrency;
- sample count, success count, error count, and invalid count; and
- first-byte and completed-response timing.

Compare only evidence with the same route, release, topology, cache method, and
concurrency. Local builds, previews, and a handful of requests are diagnostic
observations, not production acceptance.

## Capture contract

`/live` emits bounded, low-cardinality JSON events:

- `server_operation_timing` for the complete measured operation;
- `server_phase_timing` for named phases; and
- named query/cache fields used to locate data-path cost.

Record route groups, operation names, phase names, query names, durations,
outcomes, and cache states only. Never record query strings, arguments, SQL,
entity IDs, response bodies, credentials, cookies, natural-language questions,
or user data.

The data reads may overlap. Do not add phase or query durations to estimate the
critical path. Use:

- total operation duration for server latency;
- `attributedDurationMs`, the request-local union of named phase intervals, for
  the explainability gate; and
- individual phase/query events only to identify investigation candidates.

Overlapping and nested phase time is counted once in the operation-level union.
The `/live` redirect used when exactly one match is live is resolved inside the
measured handler and is not recorded as an application error.

## Sample method

1. Verify `/api/health` and `/api/readiness`, then record the exact release SHA.
2. Capture a cold or cache-cleared sample only when the environment explicitly
   permits that action. Never clear production caches casually.
3. Capture at least 20 sequential, warm, explicit-success samples. Exclude a
   documented warmup and report all errors separately.
4. If needed, run a separate bounded low-concurrency wave while observing
   health, readiness, 5xx, database pressure, RSS, and heap. This is not a load
   test.
5. Preserve time to first byte and completed-response time separately.
6. Capture the actual PostgreSQL statement count independently. One logical
   Prisma loader or named query can emit multiple statements.

Stop when health/readiness degrades, errors rise, memory becomes unsafe, or the
database shows abnormal pressure.

## Summarize JSONL

The summarizer reads a bounded local file or stdin and does not contact
production:

```sh
npm run summarize:server-timing -- \
  --file ./live-server-timing.jsonl \
  --require-coverage
```

Use `--min-samples N` only when the evidence explains why the normal threshold
changed. `--gate` remains an alias for `--require-coverage`.

The output provides deterministic nearest-rank p50/p95 values for operation,
phase, and query groups, plus sample sufficiency and separate success, error,
and invalid counts. Failed or missing outcomes never enter the successful
latency denominator.

Coverage mode requires every successful operation to have a positive duration,
finite attributed coverage within that duration, enough samples, and at least
95% operation-level explainability. It does not reconstruct coverage by adding
phase durations.

Input is bounded to protect the operator:

- 16 MiB and 100,000 lines per input;
- 1 MiB per line;
- 10,000 retained samples per group; and
- 100,000 retained samples overall.

Limit failures return a stable reason without echoing captured content.

## Decision gate

A valid result requires:

- at least 20 comparable successful samples;
- zero unexplained evidence-generation failures;
- errors reported outside the successful p50/p95 denominator;
- at least 95% named-phase explainability from the operation-level interval
  union; and
- separately captured PostgreSQL statement evidence when the change concerns
  database round trips.

The current `/live` target is production p95 below 2.0 seconds on comparable
topology, or at least 40% below an exact comparable baseline when a documented
network/topology floor makes the absolute target unattainable. Also verify that
`/api/live-status` has not materially regressed.

Do not declare success from local tests, preview data, query duration alone,
time to first byte alone, or an unrelated later release.

## Interpretation and follow-up

- High database execution time points to SQL, indexing, or data-volume work.
- Low database execution time with many statements points to ORM/pooler
  round-trip work.
- Fast server timing with slow browser navigation points to transfer, React
  Server Component, hydration, or rendering work.
- Low attribution means instrumentation must be improved before optimization is
  accepted.

Record any accepted result and the next decision in
[`../performance.md`](../performance.md). Roll back only the measured source
change unless the approved release also contained a schema or data mutation;
follow the production rollback runbook for that release.
