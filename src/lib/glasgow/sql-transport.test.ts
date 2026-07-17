import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('Glasgow 2026 one-time SQL transport', () => {
  it('is retired before it can create duplicate canonical players or incomplete rosters', async () => {
    await expect(execFileAsync(process.execPath, [
        path.resolve('scripts/build-glasgow-2026-sql-transport.mjs'),
      ])).rejects.toMatchObject({
      stderr: expect.stringContaining('cannot safely reconcile reviewed canonical players or roster positions'),
    });
  });
});
