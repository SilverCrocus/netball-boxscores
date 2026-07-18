# Glasgow 2026 rollback and emergency unpublish runbook

Use this when Glasgow public pages or data are materially wrong. Emergency
unpublish is deliberately data-preserving: it changes the edition to `DRAFT`
and hides all stages, while retaining teams, rosters, matches, results,
coverage, source snapshots, and import audit history.

## Immediate containment

1. Stop new Glasgow foundation/results imports at the operational scheduler or
   operator level.
2. Capture the current deployment ID, logs, failing URLs, latest foundation and
   results receipt IDs/checksums, and incident time.
3. Create or reuse the incident's private target-evidence directory, then run
   the guarded emergency command with a new evidence filename:

```bash
umask 077
mkdir -p "$RELEASE_EVIDENCE_DIR/glasgow/targets"
chmod 700 "$RELEASE_EVIDENCE_DIR/glasgow/targets"
npm run production:glasgow -- \
  --evidence-file "$RELEASE_EVIDENCE_DIR/glasgow/targets/emergency-unpublish.json" \
  unpublish --confirm-unpublish
```

The wrapper revalidates the production database targets, writes fresh private
refs-only evidence, and binds the child process to this exact unpublish action.
The command is idempotent for an already-DRAFT edition and refuses archived
editions. It does not execute a delete. Never invoke `db:unpublish:edition`
directly against production; the underlying command now fails closed there.

## Application rollback

If SSN or shared navigation is affected, roll the application back through the
approved deployment mechanism after unpublishing Glasgow. Do not roll database
schema back destructively; the competition migrations are additive and Glasgow
data can remain hidden.

## Data correction

- For result errors, use `glasgow-2026-compensating-correction.md` while the
  workflow state is reviewed. The published-results importer itself requires a
  published edition, so do not bypass it with direct SQL while Glasgow is
  hidden. If necessary, fix and verify in an approved preview copy first, then
  republish and apply the guarded correction in the agreed incident sequence.
- For foundation errors, prepare a revised complete bundle, record its preview,
  and apply it only while the edition is `DRAFT`. Missing former roster members
  are closed, not deleted.

## Republish

Re-run the entire publication readiness dry-run. A previous token cannot be
reused after evidence or receipt changes. Create or reuse the incident's
private target-evidence directory, enforce mode `0700`, and use a new evidence
filename for every attempt. The guarded wrapper performs a fresh production
target assertion and writes refs-only mode-`0600` evidence immediately before
each publication action.

```bash
umask 077
mkdir -p "$RELEASE_EVIDENCE_DIR/glasgow/targets"
chmod 700 "$RELEASE_EVIDENCE_DIR/glasgow/targets"

npm run production:glasgow -- \
  --evidence-file "$RELEASE_EVIDENCE_DIR/glasgow/targets/rollback-publication-dry-run.json" \
  publish --dry-run
npm run production:glasgow -- \
  --evidence-file "$RELEASE_EVIDENCE_DIR/glasgow/targets/rollback-publication-apply.json" \
  publish --apply --confirm <NEW_TOKEN>
```

Never invoke `db:publish:edition` or `db:unpublish:edition` directly during a
production rollback. A prior guard result does not carry into an incident
unpublish, republish, or later apply.

Repeat production smoke tests and monitoring before closing the incident.
