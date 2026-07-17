# Glasgow 2026 compensating correction runbook

Applied receipts and mutation history are immutable. Correct source data with a
new compensating results import; never edit the old receipt or canonical rows
directly.

## Preconditions

1. Capture the corrected source artifact and calculate its SHA-256 checksum.
2. Identify the latest successful applied `GLASGOW_RESULTS` receipt checksum.
3. Write a concise correction reason and retain the original and corrected
   source URLs/retrieval timestamps.
4. Confirm no dependent knockout match has started if the corrected outcome
   would change a winner/loser slot.
5. Inject both `DATABASE_URL` and `DIRECT_URL` from the approved production
   secret manager, set `EXPECTED_PRODUCTION_PROJECT_REF=iqnhnlttvnvkwrqvnrna`
   and `REJECTED_PREVIEW_PROJECT_REF=xpfdjkqrbvdasjpllxnc`, and configure the
   protected `PGSERVICEFILE`/`PGPASSFILE` flow in
   [`production-environment.md`](production-environment.md). Never place a
   database URL/password in a command argument or evidence file.

First prove that both importer/owner URLs resolve to the same approved
production project. Then find the latest successful applied Glasgow results
checksum through the protected libpq service. The query is read-only and
prints no credential:

```bash
npm run guard:production-target \
  > "$RELEASE_EVIDENCE_DIR/glasgow/correction-target-before-query.json"
PGSERVICE=centrepass-production-direct psql \
  --no-psqlrc --csv --set=ON_ERROR_STOP=1 <<'SQL'
SELECT run.id,
       run.checksum,
       run."completedAt",
       run.metadata ->> 'importKind' AS import_kind
FROM "ImportRun" run
JOIN "SourceSystem" source ON source.id = run."sourceSystemId"
JOIN "Competition" edition ON edition.id = run."competitionId"
JOIN "CompetitionSeries" series ON series.id = edition."seriesId"
WHERE source.key = 'glasgow-2026-public-data'
  AND series.slug = 'commonwealth-games-netball'
  AND edition.slug = 'glasgow-2026'
  AND run.status = 'SUCCEEDED'
  AND run."dryRun" = false
  AND run.metadata ->> 'importKind' = 'GLASGOW_RESULTS'
ORDER BY run."completedAt" DESC NULLS LAST, run."startedAt" DESC
LIMIT 1;
SQL
```

No row means there is no correction base: stop and use the normal first-results
workflow. Retain this query output with the incident evidence.

## Correction payload

Copy
`docs/runbooks/templates/glasgow-2026-results-correction.json` to the approved
release evidence directory and replace every placeholder. Use the complete
corrected match score and every previously stored period. Set `resultQuality`
to `CORRECTED` and add top-level evidence:

```json
{
  "correction": {
    "reason": "Official results page corrected the Q3 score and final total.",
    "correctsImportChecksum": "<LATEST_APPLIED_RESULTS_CHECKSUM>"
  }
}
```

The importer refuses a stale correction base, a silent change to a completed
result, a participant conflict, an older changed source timestamp, a period-set
regression, or a winner change after the dependent match has started.

## Execute

Use the normal three-step results workflow. Run the guard immediately before
**each** step; a previously passing guard does not carry over. Preserve each
refs-only guard output with the incident evidence.

```bash
npm run guard:production-target \
  > "$RELEASE_EVIDENCE_DIR/glasgow/correction-target-preview.json"
npm run db:import:glasgow:results -- /absolute/path/correction.json

npm run guard:production-target \
  > "$RELEASE_EVIDENCE_DIR/glasgow/correction-target-record-preview.json"
npm run db:import:glasgow:results -- /absolute/path/correction.json --record-preview

npm run guard:production-target \
  > "$RELEASE_EVIDENCE_DIR/glasgow/correction-target-apply.json"
npm run db:import:glasgow:results -- /absolute/path/correction.json --apply --confirm <TOKEN>
```

Each guard requires `DATABASE_URL` and `DIRECT_URL`, rejects the known preview
project and non-Supabase endpoints, requires both URLs to resolve uniquely to
production ref `iqnhnlttvnvkwrqvnrna`, and prints refs only. A
missing/mismatched target stops the correction before that step.

After apply, verify the match, quarter bar, pool table, bracket dependency,
coverage state, result quality label, receipt metadata, and mutation counts.
Retain both checksums in the incident/release record.

If the importer refuses the correction because a dependent match has started,
stop. Escalate for a reviewed data-repair plan rather than bypassing the guard.

Store the captured source artifact, its SHA-256, completed correction JSON,
query output and operator notes under
`<RELEASE_EVIDENCE_DIR>/glasgow/corrections/<UTC-INCIDENT-ID>/`. The launch-day
foundation/source/photo revalidation is stored separately at
`<RELEASE_EVIDENCE_DIR>/glasgow/source-revalidation.md` and follows
`glasgow-2026-source-provenance.md`; never overwrite it with later correction
evidence.
