const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

export interface PreviewDatabaseTargetEvidence {
  expectedPreviewProjectRef: string;
  productionProjectRef: string;
  databaseUrlProjectRef: string;
  directUrlProjectRef: string;
}

function requiredEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name];
  if (!value) throw new Error(`Preview database rehearsal requires ${name}`);
  return value;
}

export function projectRefFromPreviewDatabaseUrl(
  variable: 'DATABASE_URL' | 'DIRECT_URL',
  value: string,
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variable} is not a valid PostgreSQL URL`);
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`${variable} must use the PostgreSQL protocol`);
  }

  const directMatch = parsed.hostname.toLowerCase().match(
    /^db\.([a-z0-9]{20})\.supabase\.co$/,
  );
  if (directMatch) return directMatch[1];

  if (!parsed.hostname.toLowerCase().endsWith('.pooler.supabase.com')) {
    throw new Error(`${variable} is not a recognized Supabase database endpoint`);
  }
  const username = decodeURIComponent(parsed.username).toLowerCase();
  const usernameMatch = username.match(/\.([a-z0-9]{20})$/);
  if (!usernameMatch) {
    throw new Error(`${variable} pooler username does not contain a project ref`);
  }
  return usernameMatch[1];
}

export function verifyPreviewDatabaseTarget(
  environment: NodeJS.ProcessEnv = process.env,
): PreviewDatabaseTargetEvidence {
  if (environment.DATABASE_ENVIRONMENT !== 'staging') {
    throw new Error('Preview database rehearsal requires DATABASE_ENVIRONMENT=staging');
  }
  if (environment.WORKER_ENABLED !== 'false') {
    throw new Error('Preview database rehearsal requires WORKER_ENABLED=false');
  }
  if (environment.ALLOW_SHARED_PRODUCTION_DB_WRITES !== 'false') {
    throw new Error(
      'Preview database rehearsal requires ALLOW_SHARED_PRODUCTION_DB_WRITES=false',
    );
  }

  const expectedPreviewProjectRef = requiredEnvironment(
    environment,
    'EXPECTED_PREVIEW_PROJECT_REF',
  ).toLowerCase();
  const productionProjectRef = requiredEnvironment(
    environment,
    'PRODUCTION_PROJECT_REF',
  ).toLowerCase();
  if (
    !PROJECT_REF_PATTERN.test(expectedPreviewProjectRef)
    || !PROJECT_REF_PATTERN.test(productionProjectRef)
  ) {
    throw new Error('Preview and production project refs must be 20 lowercase characters');
  }
  if (expectedPreviewProjectRef === productionProjectRef) {
    throw new Error('Preview database rehearsal rejected a production-equivalent target');
  }

  const databaseUrlProjectRef = projectRefFromPreviewDatabaseUrl(
    'DATABASE_URL',
    requiredEnvironment(environment, 'DATABASE_URL'),
  );
  const directUrl = requiredEnvironment(environment, 'DIRECT_URL');
  const directUrlProjectRef = projectRefFromPreviewDatabaseUrl(
    'DIRECT_URL',
    directUrl,
  );
  const directPort = new URL(directUrl).port || '5432';
  if (directPort !== '5432') {
    throw new Error('DIRECT_URL must use a direct or session-mode endpoint on port 5432');
  }
  for (const [variable, projectRef] of [
    ['DATABASE_URL', databaseUrlProjectRef],
    ['DIRECT_URL', directUrlProjectRef],
  ] as const) {
    if (projectRef === productionProjectRef) {
      throw new Error(`${variable} targets the forbidden production project`);
    }
    if (projectRef !== expectedPreviewProjectRef) {
      throw new Error(`${variable} does not target the expected preview project`);
    }
  }

  return {
    expectedPreviewProjectRef,
    productionProjectRef,
    databaseUrlProjectRef,
    directUrlProjectRef,
  };
}
