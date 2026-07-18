import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifyPreviewDatabaseTarget } from './lib/preview-database-target';

interface ProvisioningContract {
  label: string;
  passwordVariable: string;
  psqlVariable: string;
  scriptPath: string;
}

const CONTRACTS: ProvisioningContract[] = [
  {
    label: 'analytics',
    passwordVariable: 'CENTREPASS_PREVIEW_ANALYTICS_PASSWORD',
    psqlVariable: 'analytics_password',
    scriptPath: 'scripts/provision-analytics-role.sql',
  },
  {
    label: 'stats operations',
    passwordVariable: 'CENTREPASS_PREVIEW_OPERATIONS_PASSWORD',
    psqlVariable: 'operations_password',
    scriptPath: 'scripts/provision-stats-operations-role.sql',
  },
];

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Preview scoped-role provisioning failed: ${message}`);
}

function libpqEnvironment(databaseUrl: string, passwordVariable: string, rolePassword: string) {
  const parsed = new URL(databaseUrl);
  invariant(parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:',
    'DIRECT_URL must use PostgreSQL');
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  invariant(parsed.hostname && parsed.username && database,
    'DIRECT_URL is missing required connection fields');
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: database,
    PGCONNECT_TIMEOUT: '10',
    PGAPPNAME: 'centrepass-preview-role-rehearsal',
    [passwordVariable]: rolePassword,
  };
  const sslMode = parsed.searchParams.get('sslmode');
  if (sslMode) environment.PGSSLMODE = sslMode;
  return environment;
}

function provisionContract(databaseUrl: string, contract: ProvisioningContract) {
  const rolePassword = randomBytes(32).toString('hex');
  const environment = libpqEnvironment(databaseUrl, contract.passwordVariable, rolePassword);
  const input = [
    `\\getenv ${contract.psqlVariable} ${contract.passwordVariable}`,
    `\\i ${contract.scriptPath}`,
    '',
  ].join('\n');
  const result = spawnSync('psql', [
    '--no-psqlrc',
    '--quiet',
    '--set', 'ON_ERROR_STOP=on',
  ], {
    cwd: process.cwd(),
    env: environment,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  invariant(!result.error, `psql could not start for the ${contract.label} contract`);
  invariant(result.status === 0,
    `psql rejected the ${contract.label} contract with exit code ${result.status ?? 'unknown'}`);
}

function main() {
  const target = verifyPreviewDatabaseTarget();
  const directUrl = process.env.DIRECT_URL;
  invariant(directUrl, 'DIRECT_URL is required');
  for (const contract of CONTRACTS) provisionContract(directUrl, contract);
  console.log(JSON.stringify({
    status: 'provisioned-reviewed-preview-scoped-role-contracts',
    expectedPreviewProjectRef: target.expectedPreviewProjectRef,
    productionProjectRef: target.productionProjectRef,
    contracts: CONTRACTS.map((contract) => contract.label),
    credentials: 'generated-in-memory-and-not-emitted',
  }, null, 2));
}

main();
