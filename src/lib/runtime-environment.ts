const BOOLEAN_VARIABLES = [
  'WORKER_ENABLED',
  'ALLOW_SHARED_PRODUCTION_DB_WRITES',
  'SIMULATION_MODE',
  'ANALYTICS_FEATURES_ENABLED',
  'ASK_CENTREPASS_ENABLED',
  'DRAFT_PREVIEW_ENABLED',
] as const;

const PLACEHOLDER = /(generate|replace|change[- _]?me|example|placeholder|ci-only)/i;
const STABLE_USER_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

function validUrl(value: string | undefined, protocols: readonly string[]): URL | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function validateRuntimeEnvironment(
  env: RuntimeEnvironment = process.env,
): string[] {
  const errors: string[] = [];
  const production = env.NODE_ENV === 'production';

  for (const name of BOOLEAN_VARIABLES) {
    const value = env[name];
    if (value !== undefined && value !== '' && value !== 'true' && value !== 'false') {
      errors.push(`${name} must be exactly "true" or "false"`);
    }
  }

  const port = env.PORT ?? '3000';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
    errors.push('PORT must be an integer from 1 to 65535');
  }

  for (const name of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    const url = validUrl(env[name], ['postgres:', 'postgresql:']);
    if (production && !url) errors.push(`${name} must be a valid PostgreSQL URL in production`);
    else if (env[name]?.trim() && !url) errors.push(`${name} must be a valid PostgreSQL URL`);
  }

  const authUrl = validUrl(env.NEXTAUTH_URL, ['http:', 'https:']);
  if (production && !authUrl) errors.push('NEXTAUTH_URL must be a valid URL in production');
  if (
    production
    && authUrl
    && authUrl.protocol !== 'https:'
    && !['localhost', '127.0.0.1', '::1'].includes(authUrl.hostname)
  ) {
    errors.push('NEXTAUTH_URL must use HTTPS outside localhost');
  }

  const authSecret = env.NEXTAUTH_SECRET?.trim() ?? '';
  if (production && (authSecret.length < 32 || PLACEHOLDER.test(authSecret))) {
    errors.push('NEXTAUTH_SECRET must be a non-placeholder secret of at least 32 characters in production');
  }

  const googleId = env.GOOGLE_CLIENT_ID?.trim() ?? '';
  const googleSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? '';
  if (Boolean(googleId) !== Boolean(googleSecret)) {
    errors.push('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together');
  }

  if (env.ASK_CENTREPASS_ENABLED === 'true' && env.ANALYTICS_FEATURES_ENABLED !== 'true') {
    errors.push('ASK_CENTREPASS_ENABLED requires ANALYTICS_FEATURES_ENABLED=true');
  }
  if (env.ANALYTICS_FEATURES_ENABLED === 'true') {
    if (!validUrl(env.ANALYTICS_DATABASE_URL, ['postgres:', 'postgresql:'])) {
      errors.push('ANALYTICS_DATABASE_URL must be a valid PostgreSQL URL when analytics is enabled');
    }
  }
  if (env.ASK_CENTREPASS_ENABLED === 'true') {
    if (!validUrl(env.STATS_OPERATIONS_DATABASE_URL, ['postgres:', 'postgresql:'])) {
      errors.push('STATS_OPERATIONS_DATABASE_URL must be a valid PostgreSQL URL when Ask CentrePass is enabled');
    }
    const rateSecret = env.STATS_RATE_LIMIT_SECRET?.trim() ?? '';
    if (rateSecret.length < 32 || PLACEHOLDER.test(rateSecret)) {
      errors.push('STATS_RATE_LIMIT_SECRET must be a non-placeholder secret of at least 32 characters when Ask CentrePass is enabled');
    }
  }

  if (production && env.SIMULATION_MODE === 'true') {
    errors.push('SIMULATION_MODE cannot be enabled in production');
  }

  if (env.DRAFT_PREVIEW_ENABLED === 'true') {
    const operatorIds = env.DRAFT_PREVIEW_OPERATOR_IDS?.split(',').map((value) => value.trim()) ?? [];
    if (operatorIds.length === 0 || operatorIds.some((value) => !STABLE_USER_ID.test(value))) {
      errors.push('DRAFT_PREVIEW_OPERATOR_IDS must contain only stable comma-separated user IDs when preview is enabled');
    }
  }

  for (const name of ['CHAMPION_DATA_BASE_URL', 'THESPORTSDB_BASE_URL'] as const) {
    const value = env[name]?.trim();
    if (!value) continue;
    const url = validUrl(value, production ? ['https:'] : ['http:', 'https:']);
    if (!url) errors.push(`${name} must use ${production ? 'HTTPS' : 'HTTP or HTTPS'}`);
  }

  return [...new Set(errors)];
}

export function assertRuntimeEnvironment(env: RuntimeEnvironment = process.env): void {
  const errors = validateRuntimeEnvironment(env);
  if (errors.length > 0) {
    throw new Error(`Invalid runtime environment: ${errors.join('; ')}`);
  }
}
