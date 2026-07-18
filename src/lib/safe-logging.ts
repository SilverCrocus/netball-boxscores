const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const SECRET_ASSIGNMENT = /\b(password|secret|token|api[_-]?key|authorization)\s*[:=]\s*["']?([^\s&,"'}]+)/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(URL_CREDENTIALS, '$1[redacted]@')
    .replace(BEARER_TOKEN, 'Bearer [redacted]')
    .replace(SECRET_ASSIGNMENT, '$1=[redacted]')
    .slice(0, 500);
}
