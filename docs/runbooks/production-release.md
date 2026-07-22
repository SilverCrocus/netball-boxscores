# CentrePass production release runbook

This runbook is the release control plane for CentrePass. It does **not** grant
approval to mutate production. A named human approver must issue an explicit
`GO` after the preflight evidence is complete and before any of these actions:

- the first production database mutation;
- merging the integration PR to `main`;
- starting a Render production deployment; or
- publishing Glasgow 2026.

Keep the release evidence in a durable, access-controlled location outside the
repository. Start from
[`docs/releases/production-readiness-template.md`](../releases/production-readiness-template.md).
Never put a database URL, password, token, OAuth secret, or secret value in the
evidence.

## Required inputs

Fill these before preflight. Unknown Render identifiers are deliberately not
invented by this repository.

```bash
export INTEGRATION_PR='<integration-to-main PR number or URL>'
export RELEASE_CANDIDATE_SHA='<full 40-character reviewed commit SHA>'
export PRODUCTION_BASE_URL='https://www.centrepass.io'
export RELEASE_EVIDENCE_DIR='<durable release evidence directory>'
export EXPECTED_PRODUCTION_PROJECT_REF='iqnhnlttvnvkwrqvnrna'
export REJECTED_PREVIEW_PROJECT_REF='xpfdjkqrbvdasjpllxnc'
set +x
umask 077
mkdir -p "$RELEASE_EVIDENCE_DIR"
chmod 700 "$RELEASE_EVIDENCE_DIR"
```

Keep the owner-only umask for the complete release session. Every redirected
local evidence file must remain mode `0600` and every local evidence directory
mode `0700`; if the approved evidence system enforces access outside POSIX
modes, verify its equivalent owner/release-team restriction before continuing.

Record, but do not guess:

- Render workspace: `<REQUIRED_INPUT>`
- Render service ID for the checked-in service named `centrepass`:
  `<REQUIRED_INPUT>`
- current/previous successful Render deployment ID and commit:
  `<REQUIRED_INPUT>`
- release operator, database operator, rollback owner and human approver:
  `<REQUIRED_INPUT>`

## 1. Read-only code and CI preflight

Run from a clean checkout of the reviewed release candidate:

```bash
git status --short
test "$(git rev-parse HEAD)" = "$RELEASE_CANDIDATE_SHA"
gh pr view "$INTEGRATION_PR" --json state,isDraft,mergeable,headRefOid,baseRefName,url
gh pr checks "$INTEGRATION_PR" --required
npm ci
npm audit --omit=dev --audit-level=high
npm run check
npm run build
```

Halt if the tree is dirty, the PR is draft/not mergeable/not based on `main`,
its head SHA differs, a required check is not green, the audit has an unwaived
high/critical finding, or any local command fails. Record the exact command
output and any approved audit waiver.

## 2. Prove every database URL targets production without printing it

Inject the URLs from the deployment secret manager into the process
environment. Do not pass them as command-line arguments and do not enable shell
tracing. This prints project refs only, rejects the known preview project, and
rejects hosts that are not authentic Supabase database/shared-pooler
endpoints.

```bash
set +x
npm run guard:production-target -- --include-scoped \
  > "$RELEASE_EVIDENCE_DIR/production-targets.json"
```

Any missing, ambiguous or mismatched target is an immediate `NO-GO`.
The output contains variable names and project refs only, never URLs.

## 3. Read-only migration, drift and backup preflight

Prisma schema commands use `DIRECT_URL`; it must be the production direct
endpoint or Supavisor session mode, never transaction mode. Configure the
protected libpq service and password files described in
[`production-environment.md`](production-environment.md) before running the
checked-in ledger verifier.

```bash
npx prisma migrate status
umask 077
mkdir -p "$RELEASE_EVIDENCE_DIR/migrations"
npm run guard:production-psql \
  > "$RELEASE_EVIDENCE_DIR/migrations/predeploy-psql-target.json"
touch "$RELEASE_EVIDENCE_DIR/migrations/expected-pending.txt"
# Put exactly one reviewed local-only migration directory name per line in this
# file. Leave it empty only when the reviewed release has no pending migration.
npm run verify:production-migrations -- \
  --mode predeploy \
  --expected-pending "$RELEASE_EVIDENCE_DIR/migrations/expected-pending.txt" \
  > "$RELEASE_EVIDENCE_DIR/migrations/predeploy-verification.json"
```

`migrate status` may report only the exact local pending set recorded in the
reviewed file. The verifier independently hashes every local `migration.sql`,
checks the checksum of every already-applied production version, rejects an
unknown/changed/duplicate production version, rejects failed/incomplete or
rolled-back ledger entries, and requires the local-only set to equal the
reviewed pending file exactly. Any difference is `NO-GO`.

The release candidate also carries the checked-in
[`production-catalog.json`](../../scripts/manifests/production-catalog.json),
generated from the migration-rehearsed preview database. It is the exact
SHA-256 allowlist for every custom view/materialized view/function/trigger in
`public` and `analytics`, including canonical owners, ACLs, view reloptions,
trigger enabled state, and function security/configuration attributes. The live
catalog is verified after the pending migrations are applied and before any
feature or Glasgow data is enabled.

The catalog generator is preview-only. The governed CI rehearsal may write a
deterministic artifact to `.artifacts/production-catalog.json` only after the
exact final Prisma ledger and scoped role/Data API ACL checks pass. It requires
the staging preview target guard, refuses production-equivalent URLs, and
refuses `scripts/manifests/production-catalog.json` as an output path. Review
the artifact's project-ref and `sourceMigrationThrough` before mechanically
installing it as the checked-in manifest; never hand-edit that manifest or run
the generator against production.

In the Supabase Dashboard for project `iqnhnlttvnvkwrqvnrna`:

1. Open **Database > Backups**.
2. Record the latest successful backup timestamp and PITR status/earliest
   restore point.
3. Require a restorable point no older than 24 hours and earlier than the
   planned migration. If this is unavailable, stop. Creating a manual backup is
   itself a production action and requires the explicit production `GO`.
4. Capture Security Advisor and Performance Advisor results. Unresolved
   security errors or release-query performance errors are `NO-GO`.

Complete the role/grant verification in
[`analytics-readonly-role.md`](analytics-readonly-role.md). Both public feature
flags stay off until those role probes pass.

## 4. Pre-production application evidence

The release evidence must include:

- exact preview project ref and migration rehearsal run;
- clean Glasgow foundation offline preview, database preview, apply/replay and
  DRAFT reconciliation counts;
- browser evidence for SSN and Glasgow at desktop/mobile widths;
- authentication cleanup proof (no temporary account remains);
- secret scan and reviewed diff; and
- a named rollback deployment ID/commit.

Follow [`production-smoke.md`](production-smoke.md) for browser/manual checks.
Follow the Glasgow
[`launch`](glasgow-2026-launch.md),
[`source provenance`](glasgow-2026-source-provenance.md), and
[`rollback`](glasgow-2026-rollback.md) runbooks rather than duplicating their
data rules here. Every production prepare, database preview, recorded preview,
apply, publication dry-run, publication apply, and emergency unpublish must use
the allowlisted `npm run production:glasgow` wrapper from the launch/results/
rollback runbooks with a new refs-only evidence path. The underlying commands
independently reject production execution without the wrapper's fresh,
action-bound capability. A post-deploy target check or earlier operator check
never carries forward to a later action.

### Unpublished Glasgow blocker

Inspect the exact deployed commit. If it implements
`/admin/preview/glasgow-2026`, a publication decision requires a bounded QA
window using the exact environment contract in
[`production-environment.md`](production-environment.md):

1. Keep `DRAFT_PREVIEW_ENABLED=false`; add only reviewed, stable NextAuth user
   IDs to the controlled Render `DRAFT_PREVIEW_OPERATOR_IDS` value and deploy.
   Do not record actual IDs in release evidence.
2. Immediately before QA, set the enable flag to exact lowercase `true`, deploy,
   and record the deployment ID/commit, operator, approver and window start.
3. Capture an authenticated allowlisted render of the DRAFT edition, an
   unauthenticated redirect/denial, an authenticated unallowlisted 404/denial,
   and the corresponding redacted `[DraftPreviewAudit]` outcomes.
4. Immediately after QA, set the flag to `false`, remove
   `DRAFT_PREVIEW_OPERATOR_IDS`, deploy, and prove both anonymous and previously
   authorized access are denied. Record the disabling deployment and window end.

Malformed/missing variables fail closed. Any unbounded window, missing negative
test, missing audit evidence, retained operator list or missing post-QA denial
is `NO-GO`.

If the deployed commit does not contain that route, or any part of the guarded
contract cannot be proven, **production publication is blocked**. Direct SQL is
not application smoke evidence. Do not infer the route from this runbook,
invent a URL, or temporarily mark the edition PUBLISHED to inspect it.

## 5. Human go/no-go gate

Present the completed evidence template to the named approver. The decision
must state all of the following explicitly:

```text
Decision: GO | NO-GO
Approved release candidate SHA: <40-character SHA>
Approved integration PR: <URL>
Approved production project ref: iqnhnlttvnvkwrqvnrna
Approved Render service ID: <ID>
Approved rollback deployment ID and commit: <ID> / <SHA>
Approved actions: merge to main; production migrations; Render deploy;
  Glasgow DRAFT import; Glasgow publication only after guarded unpublished QA
Approver and timestamp: <name> / <ISO-8601>
```

Silence, a green CI run, a prior conversation, or this runbook is not approval.
If the decision is `NO-GO` or any value is missing, stop.

## 6. Approved merge and Render deployment

Only after the explicit `GO`:

1. Merge the recorded integration PR through the repository's protected merge
   control. Fetch `origin/main` and record its full SHA. It must equal the
   approved release candidate or the approver must review and approve the exact
   merge SHA. After that approval, set `RELEASE_CANDIDATE_SHA` to this exact
   deployable `origin/main` SHA; the smoke command compares it byte-for-byte
   with `RENDER_GIT_COMMIT`.
2. In the Render workspace recorded above, open the service whose checked-in
   Blueprint name is **`centrepass`** in Oregon. Capture its current successful
   deployment ID and commit again.
3. Deploy the approved full commit using **Manual Deploy > Deploy a specific
   commit** (or the repository's existing automatic deploy if its event and
   commit are visible). Do not deploy an unrecorded branch head.
4. The checked-in [`render.yaml`](../../render.yaml) requires
   `preDeployCommand: npm run db:migrate:deploy`. That command is guarded: a
   Render pull-request preview (`RENDER=true`, `IS_PULL_REQUEST=true`) exits
   successfully without invoking Prisma; a Render non-preview run may invoke
   Prisma only when `IS_PULL_REQUEST=false` and `RENDER_GIT_BRANCH=main`.
   Outside Render it preserves the normal local migration behavior. Confirm in
   the deployment logs that the guard decision and any approved migration
   completed **before** the new web process started. A malformed Render
   contract, migration failure, unexpected migration, wrong service/region, or
   commit mismatch is a hard halt; do not publish Glasgow.
5. Capture deployment ID, commit, start/end time, pre-deploy logs, build result,
   and the first application logs. Never capture secret values.

Keep `ANALYTICS_FEATURES_ENABLED=false` and `ASK_CENTREPASS_ENABLED=false`, and
do not write Glasgow DRAFT data yet. Immediately after the web process starts:

```bash
npm run guard:production-target -- --include-scoped \
  > "$RELEASE_EVIDENCE_DIR/postdeploy-targets.json"
npm run guard:production-psql \
  > "$RELEASE_EVIDENCE_DIR/migrations/postdeploy-psql-target.json"
npm run verify:production-migrations -- --mode postdeploy \
  > "$RELEASE_EVIDENCE_DIR/migrations/postdeploy-verification.json"
npm run verify:production-catalog \
  > "$RELEASE_EVIDENCE_DIR/migrations/postdeploy-catalog.json"
curl --fail-with-body --silent --show-error \
  "$PRODUCTION_BASE_URL/api/readiness" \
  > "$RELEASE_EVIDENCE_DIR/readiness-before-features.json"
npm run smoke:production -- \
  --base-url "$PRODUCTION_BASE_URL" \
  --expected-commit "$RELEASE_CANDIDATE_SHA" \
  --phase baseline \
  --output-dir "$RELEASE_EVIDENCE_DIR/smoke/baseline"
```

The post-deploy migration set must be exactly equal to the local release set.
The catalog verifier hashes live `pg_get_viewdef`, `pg_get_functiondef`, and
`pg_get_triggerdef` output together with owners, ACLs, view reloptions
(`security_invoker`/`security_barrier` included), trigger enabled state, and
function owner/ACL/security/configuration attributes. It rejects incomplete,
duplicate, out-of-order, missing, extra or changed catalog state.
The commit-bound baseline smoke must pass before feature enablement or the
first Glasgow DRAFT write; it also proves Glasgow and feature routes fail
closed while their switches are off.

### Historical PR-preview migration incident

The first automatic Render PR #52 preview was created from `1fb85fd` and
inherited the base service's production database credentials. Before this
guard existed, its inherited `preDeployCommand` ran `npm run
db:migrate:deploy` and applied the additive migration
`20260722000000_add_analytics_cache_epoch` to production. The production
ledger records it as finished at `2026-07-22 05:31:39.151698+00`; the Render
preview log identified the pooler target and reported 15 migrations with no
pending migrations at its latest deployment. This mutation was not performed
manually by the release-preparation lane, is additive and ledger-clean, and
must remain in the release ledger. Do not attempt a rollback. Future PR
previews must show the guard's low-cardinality skip message and must not invoke
Prisma.

The Blueprint's Render health check is `/api/health`; liveness alone is not a
release pass. `/api/readiness` must also return `200` and `status=ready`.

## 7. Configure scoped features, verify, then import Glasgow as DRAFT

Use [`production-environment.md`](production-environment.md) and
[`analytics-readonly-role.md`](analytics-readonly-role.md):

1. Verify the scoped URLs and `STATS_RATE_LIMIT_SECRET` while both feature flags
   are false.
2. Enable `ANALYTICS_FEATURES_ENABLED=true`, redeploy/restart and require healthy
   readiness.
3. Enable `ASK_CENTREPASS_ENABLED=true`, redeploy/restart and require healthy
   readiness again.
4. Keep `WORKER_ENABLED=true`, `DATABASE_ENVIRONMENT=production`, and
   `ALLOW_SHARED_PRODUCTION_DB_WRITES=false`.

Do not continue unless the baseline smoke from step 6 is attached and passing.

Then execute the exact DRAFT import/reconciliation sequence in
[`glasgow-2026-launch.md`](glasgow-2026-launch.md). Capture receipt IDs,
checksums and exact counts. Do not publish while the unpublished application
view blocker above remains open.

## 8. Publication and final verification

After DRAFT reconciliation, launch-day source revalidation, guarded unpublished
browser QA, and a fresh publication dry-run all pass, obtain the publication
decision recorded in the evidence. Use only the confirmation-token command in
[`glasgow-2026-launch.md`](glasgow-2026-launch.md).

Immediately run:

```bash
npm run smoke:production -- \
  --base-url "$PRODUCTION_BASE_URL" \
  --expected-commit "$RELEASE_CANDIDATE_SHA" \
  --phase published \
  --output-dir "$RELEASE_EVIDENCE_DIR/smoke"
```

Complete the manual mobile/auth/accessibility checklist in
[`production-smoke.md`](production-smoke.md), then begin
[`production-monitoring.md`](production-monitoring.md). Any critical failure
invokes [`production-rollback.md`](production-rollback.md).
