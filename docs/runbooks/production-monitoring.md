# CentrePass production monitoring runbook

## Required ownership

- Release/incident owner: `<REQUIRED_INPUT>`
- Database owner: `<REQUIRED_INPUT>`
- Results-import operator: `<REQUIRED_INPUT>`
- Escalation channel/on-call contact: `<REQUIRED_INPUT>`
- Render workspace and `centrepass` service ID: `<REQUIRED_INPUT>`
- Supabase project ref: `iqnhnlttvnvkwrqvnrna`
- Release evidence location/retention period: `<REQUIRED_INPUT>` / minimum 90 days

Do not begin a release until these are assigned.

## Observation windows

| Window | Frequency | Minimum checks |
| --- | --- | --- |
| Deploy through +15 minutes | continuous logs; endpoints every minute | health, readiness, 5xx, worker, DB latency |
| +15 to +60 minutes | every 5 minutes | endpoints, Render metrics/logs, Supabase health |
| +1 to +4 hours | every 30 minutes | endpoints, error/latency/resource trends |
| Tournament match: T-30 to T+30 | every 5 minutes | worker/results import, public score/capability integrity |

Record timestamps in UTC and the deployment/commit under observation.

## Endpoint checks

```bash
curl --fail-with-body --silent --show-error \
  https://www.centrepass.io/api/health
curl --fail-with-body --silent --show-error \
  https://www.centrepass.io/api/readiness
curl --fail-with-body --silent --show-error \
  'https://www.centrepass.io/api/matches?season=2026'
```

Critical conditions:

- health non-200 twice one minute apart or commit mismatch;
- readiness non-200 twice one minute apart;
- database `ok=false` or readiness database latency at/above 2,500 ms;
- required worker disabled/unhealthy, `lastPollStatus` neither `success` nor
  `empty`, or `lastPollAt` missing/at least two times `currentIntervalMs` old;
- analytics or stats-operations state not `healthy` while enabled;
- any public DRAFT/unpublished data; or
- covered final scores disappear or unavailable capabilities appear as zero.

One transient failure is investigated immediately; two consecutive failures
invoke containment/rollback.

## Render checks

In the recorded workspace, open the checked-in service name `centrepass`:

- **Deploys/Events:** deployment ID, commit, pre-deploy migration success,
  restart/crash loops and configuration events;
- **Logs:** unhandled errors, database timeouts, worker poll failures, import
  errors, `QUERY_TIMEOUT`, `QUERY_UNAVAILABLE`, authentication failures;
- **Metrics:** requests, 5xx, latency, CPU and memory.

Escalate when 5xx exceeds 1% for five minutes, p95 latency exceeds two seconds
for ten minutes, memory stays above 85% for ten minutes, or the process restarts
unexpectedly. Record actual baselines and refine thresholds after the first
stable production window; do not silently weaken them during an incident.

## Daily navigation regression monitor

After the monitor workflow is merged to the default branch,
`.github/workflows/navigation-performance.yml` runs a sequential, read-only
browser journey each day. It covers Live, canonical Standings, Rankings, and
Records on desktop and mobile and retains JSON/Markdown evidence for 30 days.

Review:

- exact release identity, health, and readiness;
- sample sufficiency and warmup exclusion;
- route-switch and acknowledgement p50/p95;
- idle and post-intent React Server Component traffic;
- Save-Data and 2G prefetch behavior; and
- browser, same-origin request, and HTTP 5xx errors.

A release mismatch, health/readiness failure, browser failure, or missing
evidence invalidates the run and must be investigated. Performance-budget
misses remain report-only for the first 7–14 stable days. Enable enforcement
only after the distributions and decision are recorded in
[`../performance.md`](../performance.md).

Do not increase samples or concurrency and call this a load test. Follow
[`navigation-performance-monitoring.md`](navigation-performance-monitoring.md)
for the matrix, budgets, manual invocation, and evidence interpretation.

## Supabase checks

For project `iqnhnlttvnvkwrqvnrna`, inspect Database Reports/logs, connection
usage, slow queries, locks, disk/IO, Auth logs, and Security/Performance
Advisors. Escalate when connection usage exceeds 80% for ten minutes, a lock
blocks release queries for more than 30 seconds, storage approaches the plan
limit, authentication error rates materially rise, or a new security advisor
error appears. Re-run the scoped-role probes from
[`analytics-readonly-role.md`](analytics-readonly-role.md) after credential or
grant changes.

## Worker disable and restore

`WORKER_ENABLED` is the operational worker switch. The shared-write guard must
remain `ALLOW_SHARED_PRODUCTION_DB_WRITES=false`.

To contain a source/worker defect:

1. Capture `WORKER_ENABLED`, `DATABASE_ENVIRONMENT`, current deployment ID,
   `/api/readiness`, last worker poll fields and relevant logs. Record values,
   never secrets.
2. In the Render `centrepass` service, set `WORKER_ENABLED=false` and deploy the
   environment change.
3. Confirm logs show no new poll cycle/write. `/api/health` should stay live;
   `/api/readiness` will intentionally return degraded in production because
   the required worker is disabled.
4. Continue serving stable persisted data; do not set
   `ALLOW_SHARED_PRODUCTION_DB_WRITES=true` to start another writer.

Restore only after the source/worker defect is fixed and reviewed:

1. Verify `DATABASE_ENVIRONMENT=production` and
   `ALLOW_SHARED_PRODUCTION_DB_WRITES=false`.
2. Set `WORKER_ENABLED=true`, deploy the environment change and capture its ID.
3. Require a successful fresh poll, healthy `lastPollAt`, and readiness `200`.
4. Compare a known SSN match with the upstream source before closing the
   incident.

## Glasgow results operations

The official automatic workflow in
[`glasgow-2026-live-feed.md`](glasgow-2026-live-feed.md) is the normal path.
Monitor its scheduled import receipts, checksums, source snapshots, mutation
counts, worker freshness, and public score-only disclosure. The guarded manual
flow in [`glasgow-2026-results.md`](glasgow-2026-results.md) is an emergency
fallback after the automatic feed is disabled. Corrections use
[`glasgow-2026-compensating-correction.md`](glasgow-2026-compensating-correction.md).
Do not enable box scores, events, momentum, or other capabilities without a
validated source contract.

## Evidence retention and escalation

Retain redacted logs, endpoint JSON, smoke JSON/Markdown, screenshots,
deployment/migration IDs, advisor results, import receipts and incident actions
for at least 90 days (or the owner's stricter policy). Evidence must not contain
URLs with credentials, tokens, cookies, raw client identifiers or OAuth data.

Critical conditions invoke
[`production-rollback.md`](production-rollback.md). Record who decided, what was
changed, the exact rollback target, verification results and when monitoring
returned to normal.
