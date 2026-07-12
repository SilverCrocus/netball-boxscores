export async function timedQuery<T>(name: string, query: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();

  try {
    return await query();
  } finally {
    if (process.env.NODE_ENV === 'production') {
      console.info(JSON.stringify({
        event: 'server_query_timing',
        name,
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      }));
    }
  }
}
