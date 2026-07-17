#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import { lstat, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyProductionTargets } from './production-target-guard';

type GuardedActionName =
  | 'prepare'
  | 'foundation-preview'
  | 'foundation-record-preview'
  | 'foundation-apply'
  | 'results-preview'
  | 'results-record-preview'
  | 'results-apply'
  | 'publish-dry-run'
  | 'publish-apply';

export interface GuardedGlasgowAction {
  action: GuardedActionName;
  evidenceFile: string;
  script: string;
  arguments: string[];
}

interface SpawnResult {
  status: number | null;
  error?: Error;
}

interface GuardedExecutionDependencies {
  spawn?: (
    command: string,
    argumentsList: string[],
    options: { env: NodeJS.ProcessEnv; shell: false; stdio: 'inherit' },
  ) => SpawnResult;
  now?: () => Date;
}

const FOUNDATION_BUNDLE = 'data/glasgow-2026/v1/bundle.json';
const GLASGOW_IDENTITY = ['commonwealth-games-netball', 'glasgow-2026'];
const SCRIPTS_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

function usage(): never {
  throw new Error(
    'Usage: npm run production:glasgow -- --evidence-file <ABSOLUTE_JSON_PATH> '
      + '(prepare | foundation <data/glasgow-2026/v1/bundle.json> [--record-preview|--apply] '
      + '| results <ABSOLUTE_RESULTS_JSON> [--record-preview|--apply --confirm <TOKEN>] '
      + '| publish (--dry-run|--apply --confirm <TOKEN>))',
  );
}

function exactMode(
  argumentsList: string[],
  modes: ReadonlyArray<ReadonlyArray<string>>,
): string[] {
  const matched = modes.find((mode) => (
    mode.length === argumentsList.length
    && mode.every((value, index) => value === '<TOKEN>' || argumentsList[index] === value)
  ));
  if (!matched) usage();
  if (matched.includes('<TOKEN>') && !argumentsList.at(-1)?.trim()) usage();
  return argumentsList;
}

export function parseGuardedGlasgowArguments(argv: string[]): GuardedGlasgowAction {
  if (argv[0] !== '--evidence-file' || !argv[1] || !path.isAbsolute(argv[1])) usage();
  const evidenceFile = path.resolve(argv[1]);
  const action = argv[2];
  const argumentsList = argv.slice(3);

  if (action === 'prepare' && argumentsList.length === 0) {
    return { action: 'prepare', evidenceFile, script: 'prepare-glasgow-2026.ts', arguments: [] };
  }
  if (action === 'foundation') {
    const [bundle, ...mode] = argumentsList;
    if (bundle !== FOUNDATION_BUNDLE) usage();
    exactMode(mode, [[], ['--record-preview'], ['--apply']]);
    const actionName = mode[0] === '--record-preview'
      ? 'foundation-record-preview'
      : mode[0] === '--apply' ? 'foundation-apply' : 'foundation-preview';
    return {
      action: actionName,
      evidenceFile,
      script: 'import-glasgow-2026.ts',
      arguments: [bundle, ...mode],
    };
  }
  if (action === 'results') {
    const [sourceFile, ...mode] = argumentsList;
    if (!sourceFile || !path.isAbsolute(sourceFile)) usage();
    exactMode(mode, [[], ['--record-preview'], ['--apply', '--confirm', '<TOKEN>']]);
    const actionName = mode[0] === '--record-preview'
      ? 'results-record-preview'
      : mode[0] === '--apply' ? 'results-apply' : 'results-preview';
    return {
      action: actionName,
      evidenceFile,
      script: 'import-glasgow-2026-results.ts',
      arguments: [sourceFile, ...mode],
    };
  }
  if (action === 'publish') {
    exactMode(argumentsList, [['--dry-run'], ['--apply', '--confirm', '<TOKEN>']]);
    return {
      action: argumentsList[0] === '--dry-run' ? 'publish-dry-run' : 'publish-apply',
      evidenceFile,
      script: 'publish-edition.ts',
      arguments: [...GLASGOW_IDENTITY, ...argumentsList],
    };
  }
  return usage();
}

async function writeGuardEvidence(
  action: GuardedGlasgowAction,
  targets: ReturnType<typeof verifyProductionTargets>,
  now: () => Date,
): Promise<void> {
  const parent = path.dirname(action.evidenceFile);
  const parentLink = await lstat(parent);
  const parentDetails = await stat(parent);
  if (parentLink.isSymbolicLink() || !parentDetails.isDirectory()) {
    throw new Error('guard evidence parent must be a real directory');
  }
  if (typeof process.getuid === 'function' && parentDetails.uid !== process.getuid()) {
    throw new Error('guard evidence parent must be owned by the current user');
  }
  if ((parentDetails.mode & 0o077) !== 0) {
    throw new Error('guard evidence parent must have private permissions');
  }

  const file = await open(action.evidenceFile, 'wx', 0o600);
  try {
    await file.chmod(0o600);
    await file.writeFile(`${JSON.stringify({
      schemaVersion: 1,
      guard: 'centrepass-production-glasgow.v1',
      checkedAt: now().toISOString(),
      action: action.action,
      expectedProjectRef: targets.expectedProjectRef,
      targets: targets.targets,
    }, null, 2)}\n`, 'utf8');
  } finally {
    await file.close();
  }
}

export async function executeGuardedGlasgowAction(
  action: GuardedGlasgowAction,
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: GuardedExecutionDependencies = {},
): Promise<void> {
  const targets = verifyProductionTargets(environment);
  await writeGuardEvidence(action, targets, dependencies.now ?? (() => new Date()));

  const child = (dependencies.spawn ?? spawnSync)(process.execPath, [
    '--import',
    'tsx',
    path.join(SCRIPTS_DIRECTORY, action.script),
    ...action.arguments,
  ], {
    env: environment,
    shell: false,
    stdio: 'inherit',
  });
  if (child.error) throw new Error(`guarded Glasgow action could not start: ${child.error.message}`);
  if (child.status !== 0) {
    throw new Error(`guarded Glasgow action failed with exit status ${String(child.status)}`);
  }
}

async function main(): Promise<void> {
  const action = parseGuardedGlasgowArguments(process.argv.slice(2));
  await executeGuardedGlasgowAction(action);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
