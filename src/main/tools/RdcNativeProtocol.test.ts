import { describe, expect, it } from 'vitest';
import type { CLIResult } from '@shared/types/tool';
import { parseRdcNativeResult } from './RdcNativeProtocol';

describe('native failure projection', () => {
  it.each(['android_remote_socket_missing', 'android_remote_socket_ambiguous', 'renderdoc_error'])('preserves %s on nonzero CLI exit', (code) => {
    const result = { exitCode: 1, stdout: JSON.stringify({ ok: false, error: { code, message: 'Device connection failed' } }), stderr: '' } as CLIResult;
    expect(() => parseRdcNativeResult(result)).toThrow(`${code}: Device connection failed`);
  });
  it('does not accept an ok envelope from a failed process', () => {
    expect(() => parseRdcNativeResult({ exitCode: 1, stdout: JSON.stringify({ ok: true, result_kind: 'rd.remote.connect', data: {} }), stderr: '' } as CLIResult)).toThrow('RDC_CLI_FAILED');
  });
  it('classifies a process failure without stdout without exposing stderr', () => {
    const result = { exitCode: 1, stdout: '', stderr: 'private process details' } as CLIResult;
    expect(() => parseRdcNativeResult(result)).toThrow('RDC_CLI_FAILED');
    expect(() => parseRdcNativeResult(result)).not.toThrow('private process details');
  });
  it('does not display arbitrary binary stdout', () => {
    expect(() => parseRdcNativeResult({ exitCode: 1, stdout: 'binary', stderr: '' } as CLIResult)).toThrow('RDC_CLI_PROTOCOL');
  });
});
