import { describe, expect, it } from 'vitest';
import { buildSecurityHeaders } from '@/lib/security-headers';

function toHeaderMap(environment: string) {
  return new Map(buildSecurityHeaders(environment).map(({ key, value }) => [key, value]));
}

describe('security response headers', () => {
  it('enforces the production browser security boundary', () => {
    const headers = toHeaderMap('production');

    expect(headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('Content-Security-Policy')).not.toContain("'unsafe-eval'");
    expect(headers.get('Permissions-Policy')).toBe('camera=(), geolocation=(), microphone=()');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('keeps development hot reload working without advertising HSTS', () => {
    const headers = toHeaderMap('development');

    expect(headers.get('Content-Security-Policy')).toContain("'unsafe-eval'");
    expect(headers.has('Strict-Transport-Security')).toBe(false);
  });
});
