import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import process from 'node:process';

export type MigrationEnvironment = Readonly<Record<string, string | undefined>>;
export type MigrationAction = 'skip' | 'run';

export interface MigrationDecision {
  action: MigrationAction;
  reason: 'render-pr-preview' | 'approved-render-main' | 'non-render';
}

export interface MigrationRunResult extends MigrationDecision {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

type SpawnCommand = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

function exactBoolean(value: string | undefined): value is 'true' | 'false' {
  return value === 'true' || value === 'false';
}

export function decideMigrationAction(env: MigrationEnvironment = process.env): MigrationDecision {
  const render = env.RENDER;
  if (render !== undefined && render !== '' && render !== 'true' && render !== 'false') {
    throw new Error('RENDER must be exactly "true" or "false" when set');
  }
  if (render !== 'true') return { action: 'run', reason: 'non-render' };

  if (!exactBoolean(env.IS_PULL_REQUEST)) {
    throw new Error('IS_PULL_REQUEST must be exactly "true" or "false" on Render');
  }
  if (env.IS_PULL_REQUEST === 'true') {
    return { action: 'skip', reason: 'render-pr-preview' };
  }
  if (env.RENDER_GIT_BRANCH !== 'main') {
    throw new Error('Render migration execution requires RENDER_GIT_BRANCH=main');
  }
  return { action: 'run', reason: 'approved-render-main' };
}

function waitForMigrationProcess(child: ChildProcess): Promise<Pick<MigrationRunResult, 'exitCode' | 'signal'>> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });
}

export async function executeGuardedMigration(
  env: MigrationEnvironment = process.env,
  spawnCommand: SpawnCommand = spawn,
): Promise<MigrationRunResult> {
  const decision = decideMigrationAction(env);
  if (decision.action === 'skip') {
    return { ...decision, exitCode: 0, signal: null };
  }

  const child = spawnCommand('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, ...env },
    shell: false,
    stdio: 'inherit',
  });
  return { ...decision, ...(await waitForMigrationProcess(child)) };
}

async function main(): Promise<void> {
  try {
    const result = await executeGuardedMigration();
    if (result.action === 'skip') {
      console.log('[migration-guard] Render pull-request preview detected; Prisma migrations skipped');
      return;
    }
    if (result.signal) {
      process.kill(process.pid, result.signal);
      return;
    }
    process.exitCode = result.exitCode ?? 1;
  } catch (error) {
    console.error(`Migration guard failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) void main();
