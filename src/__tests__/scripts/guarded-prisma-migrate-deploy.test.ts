import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  decideMigrationAction,
  executeGuardedMigration,
  type MigrationEnvironment,
} from '../../../scripts/guarded-prisma-migrate-deploy';

function environment(overrides: MigrationEnvironment = {}): MigrationEnvironment {
  return {
    NODE_ENV: 'production',
    RENDER: 'true',
    IS_PULL_REQUEST: 'false',
    RENDER_GIT_BRANCH: 'main',
    ...overrides,
  };
}

function fakeChild(): ChildProcess {
  return new EventEmitter() as unknown as ChildProcess;
}

describe('guarded Prisma migration deploy', () => {
  it('skips a Render pull-request preview without spawning Prisma', async () => {
    const spawn = vi.fn();
    await expect(executeGuardedMigration(environment({ IS_PULL_REQUEST: 'true' }), spawn))
      .resolves.toMatchObject({ action: 'skip', exitCode: 0 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('fails closed when the Render pull-request flag is absent or malformed', () => {
    expect(() => decideMigrationAction(environment({ IS_PULL_REQUEST: undefined }))).toThrow(
      'IS_PULL_REQUEST must be exactly "true" or "false" on Render',
    );
    expect(() => decideMigrationAction(environment({ IS_PULL_REQUEST: 'yes' }))).toThrow(
      'IS_PULL_REQUEST must be exactly "true" or "false" on Render',
    );
  });

  it('rejects non-main Render non-preview deploys', () => {
    expect(() => decideMigrationAction(environment({ RENDER_GIT_BRANCH: 'feature/test' }))).toThrow(
      'Render migration execution requires RENDER_GIT_BRANCH=main',
    );
  });

  it('invokes Prisma exactly once for the exact Render main contract', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emit('close', 0, null));
      return child;
    });

    await expect(executeGuardedMigration(environment(), spawn)).resolves.toMatchObject({
      action: 'run',
      reason: 'approved-render-main',
      exitCode: 0,
      signal: null,
    });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      'npx',
      ['prisma', 'migrate', 'deploy'],
      expect.objectContaining({ shell: false, stdio: 'inherit' }),
    );
  });

  it('retains normal local behavior outside Render', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emit('close', 0, null));
      return child;
    });

    await expect(executeGuardedMigration({
      NODE_ENV: 'development',
      RENDER: undefined,
      IS_PULL_REQUEST: 'unexpected-but-irrelevant-outside-render',
    }, spawn)).resolves.toMatchObject({ action: 'run', reason: 'non-render', exitCode: 0 });
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
