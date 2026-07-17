import { describe, expect, it } from 'vitest';
import { resolveRuntimeFeatureState } from '@/lib/server-feature-flags';

describe('server-only analytics feature switches', () => {
  it('fails closed in production when flags are absent', () => {
    expect(resolveRuntimeFeatureState({ NODE_ENV: 'production' })).toEqual({
      analyticsRequested: false,
      askCentrePassRequested: false,
      analyticsEnabled: false,
      askCentrePassEnabled: false,
      configurationErrors: [],
    });
  });

  it('allows analytics independently and requires it for Ask CentrePass', () => {
    expect(resolveRuntimeFeatureState({ ANALYTICS_FEATURES_ENABLED: 'true' })).toMatchObject({
      analyticsEnabled: true,
      askCentrePassEnabled: false,
    });
    expect(resolveRuntimeFeatureState({
      ANALYTICS_FEATURES_ENABLED: 'true',
      ASK_CENTREPASS_ENABLED: 'true',
    })).toMatchObject({ analyticsEnabled: true, askCentrePassEnabled: true, configurationErrors: [] });
  });

  it('fails closed and reports invalid or dependent configuration', () => {
    expect(resolveRuntimeFeatureState({
      ANALYTICS_FEATURES_ENABLED: 'TRUE',
      ASK_CENTREPASS_ENABLED: 'true',
    })).toMatchObject({
      analyticsEnabled: false,
      askCentrePassEnabled: false,
      configurationErrors: [
        'ANALYTICS_FEATURES_ENABLED must be exactly "true" or "false"',
        'ASK_CENTREPASS_ENABLED requires ANALYTICS_FEATURES_ENABLED',
      ],
    });
  });
});
