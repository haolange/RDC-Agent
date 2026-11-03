import { describe, expect, it } from 'vitest';
import { containsSensitiveRequestKey, rdcInvocationRecord } from './RdcInvocationRecord';
describe('main validated invocation metadata', () => {
  it('retains exact native identity injection and deterministic argument fingerprint', () => {
    const record = rdcInvocationRecord('rd.debug.finish', { shader_debug_id: 'h', session_id: 'native' });
    expect(record).toMatchObject({ kind: 'main-validated-cli-arguments', args: { shader_debug_id: 'h', session_id: 'native' } });
    expect(record.argsFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(rdcInvocationRecord('rd.debug.finish', { session_id: 'native', shader_debug_id: 'h' }).argsFingerprint).toBe(record.argsFingerprint);
    expect(rdcInvocationRecord('rd.debug.finish', { shader_debug_id: 'other' }).argsFingerprint).not.toBe(record.argsFingerprint);
  });
  it('explicitly omits sensitive nested args instead of publishing secret values', () => {
    const record = rdcInvocationRecord('rd.test.call', { list: [{ authorization: 'secret value' }] });
    expect(record).toMatchObject({ argsOmittedReason: 'sensitive-argument-keys' });
    expect(record).not.toHaveProperty('args');
    expect(JSON.stringify(record)).not.toContain('secret value');
    expect(containsSensitiveRequestKey({ offset: 4, shader_debug_id: 'h' })).toBe(false);
  });
});
