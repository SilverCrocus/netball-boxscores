import 'server-only';

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

const MAX_RATE_LIMIT_KEYS = 10_000;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const globalForRequestSecurity = globalThis as typeof globalThis & {
  __centrePassRateLimits?: Map<string, RateLimitEntry>;
};

const rateLimits = globalForRequestSecurity.__centrePassRateLimits ?? new Map<string, RateLimitEntry>();
globalForRequestSecurity.__centrePassRateLimits = rateLimits;

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderSource, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export function clientIdentifier(headers: HeaderSource): string {
  // Render guarantees that the first X-Forwarded-For entry is the real client.
  const forwarded = headerValue(headers, 'x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded && isIP(forwarded)) return forwarded;
  const realIp = headerValue(headers, 'x-real-ip')?.trim();
  return realIp && isIP(realIp) ? realIp : 'unknown';
}

export function opaqueIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function consumeRateLimit(input: {
  scope: string;
  identifier: string;
  limit: number;
  windowMs: number;
  now?: number;
}): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const now = input.now ?? Date.now();
  const key = opaqueIdentifier(`${input.scope}:${input.identifier}`);
  const existing = rateLimits.get(key);
  const entry = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + input.windowMs }
    : existing;

  if (entry.count >= input.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)),
    };
  }

  entry.count += 1;
  rateLimits.delete(key);
  rateLimits.set(key, entry);

  if (rateLimits.size > MAX_RATE_LIMIT_KEYS) {
    for (const [candidate, candidateEntry] of rateLimits) {
      if (candidateEntry.resetAt <= now) rateLimits.delete(candidate);
    }
    while (rateLimits.size > MAX_RATE_LIMIT_KEYS) {
      const oldest = rateLimits.keys().next().value as string | undefined;
      if (!oldest) break;
      rateLimits.delete(oldest);
    }
  }

  return {
    allowed: true,
    remaining: Math.max(0, input.limit - entry.count),
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)),
  };
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const requestOrigin = new URL(request.url).origin;
    const browserOrigin = new URL(origin).origin;
    if (browserOrigin === requestOrigin) return true;

    // Reverse proxies can preserve the public browser Origin while presenting
    // their internal service origin in Request.url. NEXTAUTH_URL is already a
    // required, validated production setting, so it is the canonical public
    // origin to trust in that deployment shape.
    const configuredOrigin = process.env.NEXTAUTH_URL;
    return configuredOrigin !== undefined
      && browserOrigin === new URL(configuredOrigin).origin;
  } catch {
    return false;
  }
}

export type JsonObjectReadResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string };

export async function readJsonObjectWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<JsonObjectReadResult> {
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    return { ok: false, status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.' };
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, status: 413, code: 'BODY_TOO_LARGE', message: `Request bodies are limited to ${maxBytes} bytes.` };
  }

  if (!request.body) {
    return { ok: false, status: 400, code: 'INVALID_BODY', message: 'Request body must be a JSON object.' };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let raw = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        raw += decoder.decode();
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, code: 'BODY_TOO_LARGE', message: `Request bodies are limited to ${maxBytes} bytes.` };
      }
      raw += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? { ok: true, value: value as Record<string, unknown> }
      : { ok: false, status: 400, code: 'INVALID_BODY', message: 'Request body must be a JSON object.' };
  } catch {
    return { ok: false, status: 400, code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' };
  }
}
