import { describe, expect, it } from 'vitest';
import { parseRdcProcessIdentity } from './RdcProcessIdentity';

const birth = { pid: 31, start_generation: 'windows-filetime:100' };
describe('RDC process birth validation', () => {
  it.each([undefined, {}, { status: 'unavailable', reason: 'missing' },
    { status: 'available', daemon: birth, worker: birth },
    { status: 'available', daemon: birth, worker: { pid: 32, start_generation: 'same-replay-id' } },
    { status: 'available', daemon: birth, worker: { pid: 0, start_generation: 'windows-filetime:200' } },
  ])('rejects unknown or malformed process evidence %j', value => {
    expect(() => parseRdcProcessIdentity(value)).toThrow(/RDC_PROCESS_IDENTITY_REQUIRED/);
  });
  it('preserves actual OS birth formats without substituting a logical ID', () => {
    const value = { status: 'available', daemon: birth,
      worker: { pid: 32, start_generation: 'linux-start-ticks:12345678-1234-1234-1234-123456789abc:200' } };
    expect(parseRdcProcessIdentity(value)).toEqual(value);
  });
});
