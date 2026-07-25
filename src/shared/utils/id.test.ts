import { describe, expect, it } from 'vitest';
import { generateRunId, isAlphanumeric, sanitizeToken } from './id';

describe('id utilities', () => {
  it('generateRunId uses high-entropy crypto random bytes', () => {
    const ids = new Set<string>();
    for (let index = 0; index < 5_000; index += 1) {
      const runId = generateRunId();
      expect(runId).toMatch(/^run_[a-f0-9]{16}$/);
      ids.add(runId);
    }
    expect(ids.size).toBe(5_000);
  });

  it('isAlphanumeric is a plain function used by sanitizeToken', () => {
    expect(isAlphanumeric('A')).toBe(true);
    expect(isAlphanumeric('_')).toBe(false);
    expect(sanitizeToken('Hello World!')).toBe('Hello-World');
    expect((String.prototype as { isAlphanumeric?: unknown }).isAlphanumeric).toBeUndefined();
  });
});
