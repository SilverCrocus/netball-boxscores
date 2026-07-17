import { describe, expect, it } from 'vitest';
import { safeErrorMessage } from '@/lib/safe-logging';

describe('safeErrorMessage', () => {
  it('redacts URL credentials and named secrets', () => {
    const result = safeErrorMessage(new Error(
      'connect postgresql://user:private@db.example/data?token=top-secret password=hunter2',
    ));
    expect(result).toBe(
      'connect postgresql://[redacted]@db.example/data?token=[redacted] password=[redacted]',
    );
    expect(result).not.toContain('private');
    expect(result).not.toContain('top-secret');
    expect(result).not.toContain('hunter2');
  });

  it('redacts structured assignments and bearer tokens', () => {
    const result = safeErrorMessage('token: "private-value", Authorization=Bearer abc.def.ghi');
    expect(result).not.toContain('private-value');
    expect(result).not.toContain('abc.def.ghi');
  });

  it('caps untrusted error text', () => {
    expect(safeErrorMessage('x'.repeat(1_000))).toHaveLength(500);
  });
});
