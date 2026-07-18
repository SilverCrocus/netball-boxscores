import 'server-only';

export interface RuntimeFeatureEnvironment {
  NODE_ENV?: string;
  ANALYTICS_FEATURES_ENABLED?: string;
  ASK_CENTREPASS_ENABLED?: string;
}

export interface RuntimeFeatureState {
  analyticsRequested: boolean;
  askCentrePassRequested: boolean;
  analyticsEnabled: boolean;
  askCentrePassEnabled: boolean;
  configurationErrors: string[];
}

function requestedFlag(
  value: string | undefined,
  name: 'ANALYTICS_FEATURES_ENABLED' | 'ASK_CENTREPASS_ENABLED',
  errors: string[],
): boolean {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  errors.push(`${name} must be exactly "true" or "false"`);
  return false;
}

/**
 * Both features fail closed in every environment. In particular, production
 * never enables a database surface merely because a credential exists.
 */
export function resolveRuntimeFeatureState(
  env: RuntimeFeatureEnvironment = process.env,
): RuntimeFeatureState {
  const configurationErrors: string[] = [];
  const analyticsRequested = requestedFlag(
    env.ANALYTICS_FEATURES_ENABLED,
    'ANALYTICS_FEATURES_ENABLED',
    configurationErrors,
  );
  const askCentrePassRequested = requestedFlag(
    env.ASK_CENTREPASS_ENABLED,
    'ASK_CENTREPASS_ENABLED',
    configurationErrors,
  );

  if (askCentrePassRequested && !analyticsRequested) {
    configurationErrors.push('ASK_CENTREPASS_ENABLED requires ANALYTICS_FEATURES_ENABLED');
  }

  return {
    analyticsRequested,
    askCentrePassRequested,
    analyticsEnabled: analyticsRequested,
    askCentrePassEnabled: analyticsRequested && askCentrePassRequested,
    configurationErrors,
  };
}

export function analyticsFeaturesEnabled(): boolean {
  return resolveRuntimeFeatureState().analyticsEnabled;
}

export function askCentrePassEnabled(): boolean {
  return resolveRuntimeFeatureState().askCentrePassEnabled;
}
