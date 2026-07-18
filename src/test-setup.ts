import "@testing-library/jest-dom/vitest";
import { vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Server route/page tests exercise the enabled product unless a test opts into
// a kill-switch scenario explicitly. Client navigation props still default
// closed and must be enabled explicitly in component tests that need them.
process.env.ANALYTICS_FEATURES_ENABLED ??= 'true';
process.env.ASK_CENTREPASS_ENABLED ??= 'true';
