# CentrePass production readiness evidence

Copy this template for each release. Store the completed copy and referenced
artifacts in the approved evidence system. Do not include secrets, database
URLs, tokens, cookies, raw client identifiers or OAuth data.

## Release identity

- Release ID:
- Release date/window (UTC):
- Integration PR URL:
- Integration PR head SHA:
- Integration-to-main PR URL:
- Approved/main merge SHA (full 40 characters):
- Reviewed diff range:
- Release operator:
- Database operator:
- Rollback owner:
- Human approver:

## Explicit production decision

- Decision: `GO` / `NO-GO`
- Decision timestamp (ISO-8601):
- Approved production project ref: `iqnhnlttvnvkwrqvnrna`
- Approved Render workspace:
- Approved Render service ID (`centrepass`):
- Approved actions (merge / migrations / deploy / DRAFT import / publication):
- Caveats/conditions:
- Approval evidence reference:

## Code, CI and security

- `git status` evidence:
- `npm ci`:
- `npm audit --omit=dev --audit-level=high`:
- `npm run check` (test files/tests):
- `npm run build`:
- CI workflow run URL and result:
- Required PR checks:
- Secret scan tool/result:
- Review findings resolved:
- Unrelated-change review:

## Supabase and migrations

- Preview project ref: `xpfdjkqrbvdasjpllxnc`
- Production target-guard output (refs only):
- `DATABASE_URL` / `DIRECT_URL` same-project proof:
- Preview rehearsal workflow URL/result:
- `prisma migrate status`:
- explicitly reviewed local-only pending migration set:
- pre-deploy migration verifier JSON/result:
- post-deploy exact migration verifier JSON/result:
- checked-in catalog manifest source migration/ref and governed preview artifact provenance:
- post-deploy live view/function/trigger checksum verifier JSON/result:
- complete applied migration versions:
- newest applied migration:
- failed/rolled-back ledger rows (must be none):
- latest backup timestamp:
- PITR status/earliest restore point:
- Security Advisor result/evidence:
- Performance Advisor result/evidence:
- RLS/grant audit:
- analytics role probe:
- stats-operations role probe:
- query-plan evidence:

## Glasgow DRAFT reconciliation and provenance

- Foundation bundle checksum:
- Source-manifest checksum:
- Launch-day source revalidation evidence path:
  `<RELEASE_EVIDENCE_DIR>/glasgow/source-revalidation.md`
- Revalidation operator/time:
- Offline preview receipt/output:
- Database-aware preview receipt ID/checksum:
- Applied foundation receipt ID/checksum:
- Replay receipt ID/checksum:
- Reconciled counts (teams / fixtures / slots / active rosters / canonical players / photos):
- Publication dry-run token/evidence:
- Guarded unpublished application path and browser evidence:
- DRAFT preview enabling deployment/window owner/start:
- Redacted allowlisted / unauthenticated / unallowlisted audit outcomes:
- Post-QA `DRAFT_PREVIEW_ENABLED=false` deployment and denial proof:
- `DRAFT_PREVIEW_OPERATOR_IDS` removal proof (no actual IDs):
- DRAFT/unpublished verification:
- Open data/capability caveats:

If the deployed commit contains `/admin/preview/glasgow-2026`, record the
bounded `DRAFT_PREVIEW_ENABLED` window, stable allowlisted operator IDs,
authenticated success, unauthenticated/unauthorized denial, route audit
evidence, DRAFT-state proof and post-QA disablement/denial. If the route is
absent or any evidence is missing, decision is `NO-GO` for Glasgow publication.

## Render deployment

- Render service name: `centrepass`
- Render service ID/workspace:
- Previous successful deployment ID:
- Previous deployment full commit (exact rollback target):
- New deployment ID:
- New deployment full commit:
- Pre-deploy migration log evidence:
- Build/start log evidence:
- Deployment start/end time:
- `/api/health` status/body/commit:
- `/api/readiness` status/body:
- commit-bound baseline smoke before feature enablement/DRAFT writes:

## Publication and production QA

- Publication decision/approver/time:
- Publication receipt/token/checksum:
- Published status and stage verification:
- Baseline automated smoke JSON/Markdown:
- Published automated smoke JSON/Markdown:
- Desktop browser/screenshots:
- Mobile browser/screenshots:
- Accessibility evidence:
- Auth/account cleanup evidence:
- SSN regression evidence:
- Glasgow pages/data evidence:
- Rankings/records/comparison/Ask evidence:
- Canonical redirect evidence:

## Monitoring and handoff

### Phase 2 analytics memory gate

Run the post-deploy probe in two stages. First make sequential warm requests to
`/rankings` and `/records` and confirm the expected warm-cache timings. Only
after that should the operator run a bounded concurrency probe while watching
Render RSS, heap, health, readiness, and 5xx/error metrics. The preferred peak
RSS target is below 384 MiB; the hard review ceiling is below 410 MiB, leaving
20–25% headroom on the 512 MiB Starter instance. Do not run the probe against
production from this repository's release-preparation lane.

- local production-build harness command:
  `npm run stress:phase2-memory`
- representative local fixture/data confirmation:
- sequential warm `/rankings` evidence:
- sequential warm `/records` evidence:
- controlled-concurrency probe configuration/results:
- peak app RSS / heap:
- continuous `/api/health` and `/api/readiness` result:
- 5xx/unhandled-rejection result:
- Render metrics/log evidence and monitoring owner:
- headroom decision: `PASS` / `BLOCKED`

- Monitoring owner/window:
- Render logs/metrics result:
- Supabase reports/advisors result:
- Worker health/freshness:
- Results-import operator:
- Evidence archive URL and retention expiry:
- Remaining caveats:
- Final decision/status:

## Historical mutation ledger correction

The applying automatic Render PR #52 preview was the pre-guard,
`e9a252d`-era deployment at approximately 15:31 Sydney time. It inherited the
base service's production database credentials and executed the inherited
`preDeployCommand` before the migration guard existed. Render applied
`20260722000000_add_analytics_cache_epoch` to production; the production
ledger records completion at `2026-07-22 05:31:39.151698+00`. Record the exact
Render preview deployment/log evidence and the production ledger read here.
This was an automatic preview-side mutation, not a manual production action
from this lane. It was additive and ledger-clean; do not claim that no
production mutation occurred and do not attempt rollback.

`1fb85fd`, created later at approximately 19:59 Sydney time, contained the
later `0e7fbb76...` migration bytes and only observed/verified preview
behavior; it could not have applied the production ledger row carrying
checksum `1f7d2690...`. The migration guard arrived in `0895da8`; future PR
previews must show the guard-skip evidence and must not invoke Prisma.

- historical Render PR preview service: `srv-d9g5akn7f7vs73eqt52g`
- historical preview URL: `https://centrepass-pr-52.onrender.com`
- historical base service: `srv-d71t7iaa214c73eaqmcg`
- historical mutation migration:
- historical Render pre-deploy evidence:
- production ledger evidence:
- next preview guard-skip log evidence:

## Exact rollback instructions

- Incident trigger(s):
- Glasgow emergency-unpublish command owner:
- Feature/worker containment values:
- Render rollback deployment ID:
- Render rollback full commit:
- Post-rollback health/readiness checks:
- Post-rollback SSN/Glasgow/auth checks:
- Incident/escalation contact:
