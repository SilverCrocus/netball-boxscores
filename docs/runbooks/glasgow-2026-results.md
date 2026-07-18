# Glasgow 2026 results import runbook

The results importer is the only supported manual workflow for changing a
published Glasgow match. It is intentionally narrower than the foundation
importer and cannot create teams, players, entries, or matches.

## Input contract

The JSON document uses schema version 1:

```json
{
  "schemaVersion": 1,
  "edition": "glasgow-2026",
  "sourceKey": "glasgow-2026-public-data",
  "retrievedAt": "2026-07-25T11:00:00.000Z",
  "sourceManifest": {
    "schemaVersion": 1,
    "version": "official-results-2026-07-25T11:00:00Z",
    "checksum": "<SHA-256 of the captured source artifact>",
    "sources": [
      {
        "id": "official-match-result",
        "url": "https://example.invalid/replace-with-the-real-source",
        "retrievedAt": "2026-07-25T11:00:00.000Z",
        "purpose": "official final score and quarter scores"
      }
    ]
  },
  "results": [
    {
      "matchExternalId": "<existing source match ID>",
      "sideAExternalId": "AUS",
      "sideBExternalId": "NZL",
      "status": "COMPLETED",
      "resultQuality": "OFFICIAL_FINAL",
      "sideAScore": 60,
      "sideBScore": 50,
      "sourceUpdatedAt": "2026-07-25T10:59:00.000Z",
      "periods": [
        { "period": 1, "sideAScore": 15, "sideBScore": 12 },
        { "period": 2, "sideAScore": 14, "sideBScore": 13 },
        { "period": 3, "sideAScore": 16, "sideBScore": 11 },
        { "period": 4, "sideAScore": 15, "sideBScore": 14 }
      ]
    }
  ]
}
```

Period scores are per-period increments, not cumulative match totals. For a
completed match, supplied periods must be unique, contiguous from period 1,
contain at least four regulation periods, and sum exactly to the final score.
Omit `periods` if the source does not provide them; the importer records period
coverage as unavailable rather than inventing a breakdown.

Status/quality pairs are strict:

- `LIVE` uses `PROVISIONAL`.
- `COMPLETED` uses `UNOFFICIAL_FINAL`, `OFFICIAL_FINAL`, or `CORRECTED`.
- `DELAYED`, `POSTPONED`, `CANCELLED`, and `ABANDONED` use `UNKNOWN` with zero
  scores and no periods.

## Preview, record, apply

Create or reuse the release's private mode-`0700` target-evidence directory.
Use a new evidence filename for every attempt. The production wrapper validates
the exact variable-specific `DATABASE_URL` and `DIRECT_URL` contracts in the
same process immediately before it invokes the results importer; its mode-`0600`
evidence contains project refs only.

```bash
umask 077
mkdir -p "$RELEASE_EVIDENCE_DIR/glasgow/targets"
chmod 700 "$RELEASE_EVIDENCE_DIR/glasgow/targets"

npm run production:glasgow -- \
  --evidence-file "$RELEASE_EVIDENCE_DIR/glasgow/targets/results-preview.json" \
  results /absolute/path/results.json
npm run production:glasgow -- \
  --evidence-file "$RELEASE_EVIDENCE_DIR/glasgow/targets/results-record-preview.json" \
  results /absolute/path/results.json --record-preview
npm run production:glasgow -- \
  --evidence-file "$RELEASE_EVIDENCE_DIR/glasgow/targets/results-apply.json" \
  results /absolute/path/results.json --apply --confirm <TOKEN>
```

The edition must already be `PUBLISHED`. Apply re-runs the same validation in a
serializable transaction and requires the exact recorded-preview token. It
resolves only existing mapped matches and mapped participants.
Do not invoke `db:import:glasgow:results` directly in production; it is a
development entrypoint and fails closed there unless it is the action-bound
child of `production:glasgow` with fresh target evidence.

The transaction atomically updates:

- match participants, score, lifecycle status, quality, and source timestamps;
- supplied quarter rows;
- match-specific final-score and period-score coverage;
- Pool A/B standings using the international 2/1/0 points strategy;
- dependent `MATCH_WINNER` and `MATCH_LOSER` bracket slots; and
- immutable import receipts, mutation rows, and source snapshot metadata.

An exact replay records a replay receipt and skips canonical writes. Mutation
counts in a non-replay receipt are derived from the actual audited mutations.

Do not put player box scores, team box scores, events, score flow, Net Points,
or lineups in this file. Those capabilities remain unavailable until a source
actually provides a separately validated contract.
