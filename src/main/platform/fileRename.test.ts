import { describe, expect, it, vi } from 'vitest';
import { renameWithRetrySync } from './fileRename';
import { describeHost } from './host';

const failing = (code: string, failures: number) => {
  let calls = 0;
  return vi.fn(() => {
    calls += 1;
    if (calls <= failures) throw Object.assign(new Error(code), { code });
  });
};

describe('renameWithRetrySync', () => {
  it('retries a rename Windows briefly refuses while another process holds the target', () => {
    const rename = failing('EBUSY', 2);
    renameWithRetrySync('a', 'b', describeHost('win32', 'x64'), rename);
    expect(rename).toHaveBeenCalledTimes(3);
  });

  it('gives up after a bounded number of attempts', () => {
    const rename = failing('EPERM', 99);
    expect(() => renameWithRetrySync('a', 'b', describeHost('win32', 'x64'), rename)).toThrow('EPERM');
    expect(rename).toHaveBeenCalledTimes(5);
  });

  it('does not retry on POSIX, where these errors are not transient', () => {
    const rename = failing('EPERM', 1);
    expect(() => renameWithRetrySync('a', 'b', describeHost('linux', 'x64'), rename)).toThrow('EPERM');
    expect(rename).toHaveBeenCalledTimes(1);
  });
});
