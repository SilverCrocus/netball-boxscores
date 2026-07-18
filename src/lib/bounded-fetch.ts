type NextFetchInit = RequestInit & {
  next?: { revalidate?: number };
};

export async function fetchJsonWithinLimits<T>(input: {
  url: string;
  label: string;
  timeoutMs: number;
  maxBytes: number;
  init?: NextFetchInit;
}): Promise<T> {
  const response = await fetch(input.url, {
    ...input.init,
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${input.label} error: ${response.status} ${response.statusText}`.trim());
  }

  // Test doubles and non-standard fetch adapters may expose json() without a
  // web stream. Native Node/Next responses always use the bounded path below.
  if (!response.headers || !response.body) return response.json() as Promise<T>;

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > input.maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${input.label} response exceeded ${input.maxBytes} bytes`);
  }
  if (!response.body) throw new Error(`${input.label} response did not contain a body`);

  const reader = response.body.getReader();
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
      if (bytes > input.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${input.label} response exceeded ${input.maxBytes} bytes`);
      }
      raw += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${input.label} response was not valid JSON`);
  }
}
