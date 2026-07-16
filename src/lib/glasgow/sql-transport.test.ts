import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('Glasgow 2026 one-time SQL transport', () => {
  it('records every first-import match slot as an INSERT mutation', async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'glasgow-sql-transport-'));
    const previewPath = path.join(temporaryDirectory, 'preview.json');

    try {
      await writeFile(previewPath, JSON.stringify({
        valid: true,
        checksum: 'regression-checksum',
        issues: [],
        unresolved: [],
        writes: [],
      }));

      const { stdout: generatedSql } = await execFileAsync(process.execPath, [
        path.resolve('scripts/build-glasgow-2026-sql-transport.mjs'),
        path.resolve('data/glasgow-2026/v1/bundle.json'),
        previewPath,
      ], { maxBuffer: 1024 * 1024 });

      expect(generatedSql).toContain(`'INSERT'::"ImportMutationOperation",\n    'MATCH_SLOT'::"ImportMutationTarget"`);
      expect(generatedSql).not.toContain(`CASE WHEN slot."resolvedEntryId" IS NULL THEN 'INSERT' ELSE 'UPDATE' END`);
      expect(generatedSql).toContain(`"sourceMatchId" = EXCLUDED."sourceMatchId"`);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
