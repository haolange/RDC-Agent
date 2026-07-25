import { describe, expect, it } from 'vitest';
import { resolveExitCode } from './ShellInvocationService';

describe('ShellInvocationService exit codes', () => {
  it('preserves explicit exit codes', () => {
    expect(resolveExitCode(0, null)).toBe(0);
    expect(resolveExitCode(2, null)).toBe(2);
  });

  it('maps signal exits to 128+signal instead of success', () => {
    expect(resolveExitCode(null, 'SIGTERM')).toBe(128 + 15);
    expect(resolveExitCode(null, 'SIGKILL')).toBe(128 + 9);
  });

  it('fails closed when code and signal are both missing', () => {
    expect(resolveExitCode(null, null)).toBe(1);
  });
});
