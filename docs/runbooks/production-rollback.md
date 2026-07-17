# CentrePass production rollback runbook

This runbook restores a known deployment and contains Glasgow without deleting
audit history. It does not authorize an incident mutation: the incident
commander or named release approver must authorize the rollback/unpublish under
the team's production policy.

## Trigger conditions

Rollback or contain immediately when any of these is true:

- `/api/health` is non-200 for two consecutive checks one minute apart;
- `/api/readiness` is non-200 for two consecutive checks one minute apart;
- the deployed commit differs from the approved commit;
- migrations/pre-deploy failed or an unexpected version was applied;
- SSN scores, navigation, authentication or canonical redirects regress;
- unpublished/private data becomes public;
- Glasgow reconciliation/publication invariants fail; or
- sustained Render 5xx exceeds 1% for five minutes.

## Capture before changing state

Record the incident time, operator, affected URLs, Render service/deployment ID,
deployed commit, previous known-good deployment ID/commit, health/readiness
JSON, relevant redacted logs, newest applied migration, Glasgow publication
status, and latest foundation/results receipt IDs/checksums. Never copy secrets.

The exact rollback target must already be in the release evidence. If it is
unknown, stop and identify the last successful deployment in the Render
service's deployment history; do not select a commit by guesswork.

## Containment order

1. **Glasgow-only data/content defect:** follow
   [`glasgow-2026-rollback.md`](glasgow-2026-rollback.md) and emergency-unpublish
   first. That operation preserves all imported rows and audit receipts.
2. **Ask CentrePass defect:** set `ASK_CENTREPASS_ENABLED=false` and deploy the
   environment change. Analytics may remain available.
3. **Any analytics data-exposure defect:** set both
   `ASK_CENTREPASS_ENABLED=false` and `ANALYTICS_FEATURES_ENABLED=false`, then
   deploy the environment change.
4. **Worker/source defect:** use the worker procedure in
   [`production-monitoring.md`](production-monitoring.md). A disabled production
   worker intentionally makes `/api/readiness` degraded until restored.
5. **Shared application regression:** redeploy the recorded previous known-good
   Render deployment.

## Render application rollback

The checked-in service name is `centrepass`; its service ID/workspace must come
from the release evidence. In the Render Dashboard:

1. Open **centrepass > Deploys**.
2. Select the recorded previous successful deployment ID and verify its full
   commit SHA.
3. Choose **Redeploy** for that exact deployment.
4. Capture the new rollback deployment ID and logs.
5. Confirm the web process starts and `/api/health` returns HTTP 200. If the
   rollback target implements `release.commit`, it must exactly equal the
   recorded rollback SHA. For a legacy target that predates that field, prove
   the commit from the recorded Render deployment ID/details and the startup
   log attached to that same deployment; record both artifacts.

Do not run reverse/destructive schema SQL. CentrePass migrations in this release
must be treated as forward-compatible/additive. If the old application cannot
run against the migrated schema, leave the new application contained with
feature flags and escalate for a reviewed forward fix.

## Post-rollback verification

```bash
curl --fail-with-body --silent --show-error \
  https://www.centrepass.io/api/health
curl --fail-with-body --silent --show-error \
  https://www.centrepass.io/api/readiness
curl --fail-with-body --silent --show-error \
  'https://www.centrepass.io/api/matches?season=2026'
```

Verify:

- health is HTTP 200. When the response exposes `release.commit`, it is
  mandatory and must equal the recorded rollback SHA. Only a legacy deployment
  known to predate the field may use the Render deployment/details plus its
  startup log as commit proof; once the endpoint supports the SHA, a missing or
  mismatched value is a rollback failure;
- readiness is `ready`, except during an explicitly documented worker-disable
  containment window;
- SSN public results and canonical match links are correct;
- Glasgow returns 404 if emergency-unpublished;
- disabled features are absent from navigation and their server routes fail
  closed; and
- no temporary authentication user/session remains.

If the rollback target supports the current full release contract, rerun the
read-only smoke command in [`production-smoke.md`](production-smoke.md). Keep
monitoring for at least 60 minutes and attach all evidence to the incident.

## Recovery

Correct Glasgow data only with the
[`compensating correction`](glasgow-2026-compensating-correction.md) or revised
DRAFT bundle workflow. Re-provision/rotate scoped roles using
[`analytics-readonly-role.md`](analytics-readonly-role.md). Any redeploy or
republish requires a new go/no-go record; prior confirmation tokens and approval
do not carry over.
