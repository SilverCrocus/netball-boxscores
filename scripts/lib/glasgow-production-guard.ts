import { createHash, timingSafeEqual } from 'node:crypto';
import { lstat, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { verifyProductionTargets } from '../production-target-guard';

export const GLASGOW_PRODUCTION_GUARD = 'centrepass-production-glasgow.v1';
export const APPROVED_PRODUCTION_PROJECT_REF = 'iqnhnlttvnvkwrqvnrna';

export const GLASGOW_GUARD_ENVIRONMENT = {
  guard: 'CENTREPASS_GLASGOW_PRODUCTION_GUARD',
  action: 'CENTREPASS_GLASGOW_PRODUCTION_ACTION',
  evidenceFile: 'CENTREPASS_GLASGOW_PRODUCTION_EVIDENCE_FILE',
  nonce: 'CENTREPASS_GLASGOW_PRODUCTION_NONCE',
  wrapperPid: 'CENTREPASS_GLASGOW_PRODUCTION_WRAPPER_PID',
} as const;

export type GlasgowDatabaseAction =
  | 'prepare'
  | 'foundation-preview'
  | 'foundation-record-preview'
  | 'foundation-apply'
  | 'results-preview'
  | 'results-record-preview'
  | 'results-apply'
  | 'publish-dry-run'
  | 'publish-apply'
  | 'unpublish-apply';

interface GlasgowProductionGuardEvidence {
  schemaVersion: 1;
  guard: typeof GLASGOW_PRODUCTION_GUARD;
  checkedAt: string;
  action: GlasgowDatabaseAction;
  expectedProjectRef: string;
  targets: Record<string, string>;
  executionNonceSha256: string;
  wrapperPid: number;
}

interface GuardDependencies {
  now?: () => Date;
  parentPid?: () => number;
}

const DATABASE_ENVIRONMENTS = new Set([
  'local',
  'development',
  'test',
  'staging',
  'production',
]);
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const NONCE_PATTERN = /^[a-f0-9]{64}$/;
const MAX_EVIDENCE_AGE_MS = 5 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 30 * 1000;

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Glasgow database action requires ${name}`);
  return value;
}

function routedProjectRef(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const directMatch = /^db\.([a-z0-9]{20})\.supabase\.co$/
    .exec(parsed.hostname.toLowerCase());
  if (directMatch?.[1]) return directMatch[1];

  let username: string;
  try {
    username = decodeURIComponent(parsed.username).toLowerCase();
  } catch {
    return null;
  }
  const parts = username.split('.');
  const candidate = parts.length === 2 ? parts[1] : null;
  return candidate && PROJECT_REF_PATTERN.test(candidate) ? candidate : null;
}

function targetsApprovedProduction(environment: NodeJS.ProcessEnv): boolean {
  return ['DATABASE_URL', 'DIRECT_URL'].some((name) => {
    const value = environment[name];
    return value ? routedProjectRef(value) === APPROVED_PRODUCTION_PROJECT_REF : false;
  });
}

function parseEvidence(raw: string): GlasgowProductionGuardEvidence {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Glasgow production guard evidence is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Glasgow production guard evidence has an invalid shape');
  }
  return parsed as GlasgowProductionGuardEvidence;
}

export function hashGlasgowProductionNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

export async function assertGlasgowDatabaseActionAllowed(
  action: GlasgowDatabaseAction,
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: GuardDependencies = {},
): Promise<'non-production' | 'guarded-production'> {
  const databaseEnvironment = requiredEnvironment(environment, 'DATABASE_ENVIRONMENT')
    .toLowerCase();
  if (!DATABASE_ENVIRONMENTS.has(databaseEnvironment)) {
    throw new Error('Glasgow database action requires a reviewed DATABASE_ENVIRONMENT');
  }

  const productionIntent = databaseEnvironment === 'production'
    || environment.EXPECTED_PRODUCTION_PROJECT_REF?.toLowerCase()
      === APPROVED_PRODUCTION_PROJECT_REF
    || targetsApprovedProduction(environment);

  if (!productionIntent) return 'non-production';

  if (environment[GLASGOW_GUARD_ENVIRONMENT.guard] !== GLASGOW_PRODUCTION_GUARD) {
    throw new Error(
      'Glasgow production database actions must run through npm run production:glasgow',
    );
  }
  if (environment[GLASGOW_GUARD_ENVIRONMENT.action] !== action) {
    throw new Error('Glasgow production guard action does not match the requested operation');
  }

  const evidenceFile = requiredEnvironment(
    environment,
    GLASGOW_GUARD_ENVIRONMENT.evidenceFile,
  );
  if (!path.isAbsolute(evidenceFile) || path.resolve(evidenceFile) !== evidenceFile) {
    throw new Error('Glasgow production guard evidence path must be absolute and normalized');
  }
  const linkDetails = await lstat(evidenceFile);
  const fileDetails = await stat(evidenceFile);
  if (linkDetails.isSymbolicLink() || !fileDetails.isFile()) {
    throw new Error('Glasgow production guard evidence must be a real file');
  }
  if (typeof process.getuid === 'function' && fileDetails.uid !== process.getuid()) {
    throw new Error('Glasgow production guard evidence must be owned by the current user');
  }
  if ((fileDetails.mode & 0o777) !== 0o600) {
    throw new Error('Glasgow production guard evidence must have mode 0600');
  }

  const evidence = parseEvidence(await readFile(evidenceFile, 'utf8'));
  if (evidence.schemaVersion !== 1 || evidence.guard !== GLASGOW_PRODUCTION_GUARD) {
    throw new Error('Glasgow production guard evidence contract is invalid');
  }
  if (evidence.action !== action) {
    throw new Error('Glasgow production guard evidence is bound to a different action');
  }

  const checkedAt = Date.parse(evidence.checkedAt);
  const now = (dependencies.now ?? (() => new Date()))().getTime();
  if (!Number.isFinite(checkedAt)
    || checkedAt < now - MAX_EVIDENCE_AGE_MS
    || checkedAt > now + MAX_FUTURE_SKEW_MS) {
    throw new Error('Glasgow production guard evidence is stale or future-dated');
  }

  const wrapperPidText = requiredEnvironment(
    environment,
    GLASGOW_GUARD_ENVIRONMENT.wrapperPid,
  );
  if (!/^[1-9][0-9]*$/.test(wrapperPidText)) {
    throw new Error('Glasgow production guard wrapper PID is invalid');
  }
  const wrapperPid = Number(wrapperPidText);
  if (!Number.isSafeInteger(wrapperPid)
    || evidence.wrapperPid !== wrapperPid
    || (dependencies.parentPid ?? (() => process.ppid))() !== wrapperPid) {
    throw new Error('Glasgow production database action was not started by the guarded wrapper');
  }

  const nonce = requiredEnvironment(environment, GLASGOW_GUARD_ENVIRONMENT.nonce);
  if (!NONCE_PATTERN.test(nonce)
    || !SHA256_PATTERN.test(evidence.executionNonceSha256)) {
    throw new Error('Glasgow production guard execution nonce is invalid');
  }
  const actualNonceHash = hashGlasgowProductionNonce(nonce);
  if (!timingSafeEqual(
    Buffer.from(actualNonceHash, 'hex'),
    Buffer.from(evidence.executionNonceSha256, 'hex'),
  )) {
    throw new Error('Glasgow production guard execution nonce does not match the evidence');
  }

  const targets = verifyProductionTargets(environment);
  if (targets.expectedProjectRef !== APPROVED_PRODUCTION_PROJECT_REF
    || evidence.expectedProjectRef !== targets.expectedProjectRef
    || JSON.stringify(evidence.targets) !== JSON.stringify(targets.targets)) {
    throw new Error('Glasgow production guard evidence does not match the current production target');
  }

  return 'guarded-production';
}
