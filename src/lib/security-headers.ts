type SecurityHeader = Readonly<{ key: string; value: string }>;

const PHOTO_ORIGINS = [
  'https://www.thesportsdb.com',
  'https://r2.thesportsdb.com',
  'https://upload.wikimedia.org',
];

function buildContentSecurityPolicy(environment: string): string {
  const developmentScriptSource = environment === 'production' ? '' : " 'unsafe-eval'";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'frame-src https://crs-cg2026.glasgow2026.com',
    "object-src 'none'",
    `script-src 'self' 'unsafe-inline'${developmentScriptSource}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${PHOTO_ORIGINS.join(' ')}`,
    "connect-src 'self' ws: wss:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
  ].join('; ');
}

export function buildSecurityHeaders(
  environment: string = process.env.NODE_ENV ?? 'development',
): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: 'Content-Security-Policy', value: buildContentSecurityPolicy(environment) },
    { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=()' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  ];

  if (environment === 'production') {
    headers.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000' });
  }

  return headers;
}
