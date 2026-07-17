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
- checked-in catalog manifest source migration/ref:
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
- DRAFT/unpublished verification:
- Open data/capability caveats:

If no real guarded unpublished application path exists, decision is `NO-GO`
for Glasgow publication.

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

- Monitoring owner/window:
- Render logs/metrics result:
- Supabase reports/advisors result:
- Worker health/freshness:
- Results-import operator:
- Evidence archive URL and retention expiry:
- Remaining caveats:
- Final decision/status:

## Exact rollback instructions

- Incident trigger(s):
- Glasgow emergency-unpublish command owner:
- Feature/worker containment values:
- Render rollback deployment ID:
- Render rollback full commit:
- Post-rollback health/readiness checks:
- Post-rollback SSN/Glasgow/auth checks:
- Incident/escalation contact:
