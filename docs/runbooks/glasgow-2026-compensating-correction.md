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

## Correction payload

Use the complete corrected match score and every previously stored period. Set
`resultQuality` to `CORRECTED` and add top-level evidence:

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

Use the normal three-step results workflow:

```bash
npm run db:import:glasgow:results -- /absolute/path/correction.json
npm run db:import:glasgow:results -- /absolute/path/correction.json --record-preview
npm run db:import:glasgow:results -- /absolute/path/correction.json --apply --confirm <TOKEN>
```

After apply, verify the match, quarter bar, pool table, bracket dependency,
coverage state, result quality label, receipt metadata, and mutation counts.
Retain both checksums in the incident/release record.

If the importer refuses the correction because a dependent match has started,
stop. Escalate for a reviewed data-repair plan rather than bypassing the guard.
