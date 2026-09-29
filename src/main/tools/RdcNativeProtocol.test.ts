import { describe, expect, it } from 'vitest';
import type { CLIResult } from '@shared/types/tool';
import { parseRdcNativeResult, RdcNativeFailure } from './RdcNativeProtocol';

describe('native failure projection', () => {
  it('distinguishes truncated stdout from malformed native output without disclosing its content', () => {
    const truncated = { exitCode: 0, stdout: 'private tail', stdoutByteLength: 9000000, stdoutTruncated: true, stderr: '' } as CLIResult;
    expect(() => parseRdcNativeResult(truncated)).toThrow('RDC_CLI_OUTPUT_TRUNCATED');
    expect(() => parseRdcNativeResult(truncated)).not.toThrow('private tail');
    const malformed = { exitCode: 0, stdout: 'private prefix', stdoutByteLength: 14, stdoutTruncated: false, stderr: '' } as CLIResult;
    expect(() => parseRdcNativeResult(malformed)).toThrow('stdoutBytes=14, prefix=other');
    expect(() => parseRdcNativeResult(malformed)).not.toThrow('private prefix');
  });
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
  it('shows only a bounded recovery code for failed shader rollback', () => {
    const result = { exitCode: 1, stdout: JSON.stringify({ ok: false, error: {
      code: 'replacement_revert_recovery_failed', message: 'Replay recovery failed',
      details: { recovery_error_code: 'adb_forward_failed', error: 'private device details' },
    } }), stderr: '' } as CLIResult;
    expect(() => parseRdcNativeResult(result)).toThrow('Replay recovery failed (recovery: adb_forward_failed)');
    expect(() => parseRdcNativeResult(result)).not.toThrow('private device details');
  });
  it('preserves a bounded context cleanup reason without exposing native details', () => {
    const result = { exitCode: 1, stdout: JSON.stringify({ ok: false, error: {
      code: 'context_cleanup_failed', message: 'Context cleanup failed',
      details: { cleanup_reason_code: 'expired_remote_cleanup_failed', cleanup_errors: ['private device details'] },
    } }), stderr: '' } as CLIResult;
    expect(() => parseRdcNativeResult(result)).toThrow('Context cleanup failed (cleanup: expired_remote_cleanup_failed)');
    expect(() => parseRdcNativeResult(result)).not.toThrow('private device details');
  });
  it('retains only canonical proof that a replacement was never attempted', () => {
    const result = { exitCode: 1, stdout: JSON.stringify({ schema_version: '3.0.0',
      result_kind: 'rd.shader.edit_and_replace', ok: false, error: {
        code: 'shader_patch_op_unsupported_for_encoding', category: 'validation', message: 'Source cannot be edited',
        details: { replacement_attempted: false, context_preserved: true, private_path: 'do not expose' },
      } }), stderr: '' } as CLIResult;
    let failure: unknown;
    try { parseRdcNativeResult(result, undefined, 'rd.shader.edit_and_replace'); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(RdcNativeFailure);
    expect(failure).toMatchObject({ resultKind: 'rd.shader.edit_and_replace', replacementNotAttempted: true });
    expect((failure as Error).message).not.toContain('private_path');
  });
  it('retains only canonical proof that no native effect was attempted', () => {
    const envelope = { schema_version: '3.0.0', result_kind: 'rd.pipeline.get_state', ok: false,
      error: { code: 'unsupported_target', category: 'validation', message: 'Target unavailable',
        details: { effects_attempted: false, context_preserved: true, private_path: 'do not expose' } } };
    let failure: unknown;
    try { parseRdcNativeResult({ exitCode: 1, stdout: JSON.stringify(envelope), stderr: '' } as CLIResult,
      undefined, 'rd.pipeline.get_state'); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ resultKind: 'rd.pipeline.get_state', effectsNotAttempted: true });
    expect((failure as Error).message).not.toContain('private_path');
    for (const change of [
      { schema_version: '2.0.0' }, { result_kind: 'rd.pipeline.other' },
      { error: { ...envelope.error, category: 'runtime' } },
      { error: { ...envelope.error, details: { effects_attempted: true, context_preserved: true } } },
      { error: { ...envelope.error, details: { effects_attempted: false, context_preserved: false } } },
    ]) {
      let rejected: unknown;
      try { parseRdcNativeResult({ exitCode: 1, stdout: JSON.stringify({ ...envelope, ...change }), stderr: '' } as CLIResult,
        undefined, 'rd.pipeline.get_state'); } catch (error) { rejected = error; }
      expect(rejected).toMatchObject({ effectsNotAttempted: false });
    }
  });
  it('retains only exact failed screenshot target restoration proof', () => {
    const envelope = { schema_version: '3.0.0', result_kind: 'rd.export.screenshot', ok: false,
      error: { code: 'preview_event_output_unavailable', category: 'runtime', message: 'No target',
        details: { context_id: 'owned-context', session_id: 'native-replay', failure_stage: 'resolve_visual_target',
          replay_state_restored: true, restored_event_id: 11, artifact_write_attempted: false } } };
    const parse = (value: object, exitCode = 1) => {
      try { parseRdcNativeResult({ exitCode, stdout: JSON.stringify(value), stderr: '' } as CLIResult,
        undefined, 'rd.export.screenshot'); } catch (error) { return error as RdcNativeFailure; }
      throw new Error('Expected native failure');
    };
    expect(parse(envelope).screenshotTargetRestoration).toEqual({ contextId: 'owned-context', sessionId: 'native-replay', eventId: 11 });
    for (const details of [
      { ...envelope.error.details, replay_state_restored: false },
      { ...envelope.error.details, artifact_write_attempted: true },
      { ...envelope.error.details, failure_stage: 'save_texture' },
      { ...envelope.error.details, restored_event_id: 0 },
    ]) {
      expect(parse({ ...envelope, error: { ...envelope.error, details } }).screenshotTargetRestoration).toBeNull();
    }
    expect(parse({ ...envelope, schema_version: '2.0.0' }).screenshotTargetRestoration).toBeNull();
    expect(parse({ ...envelope, result_kind: 'rd.export.texture' }).screenshotTargetRestoration).toBeNull();
    expect(parse({ ...envelope, error: { ...envelope.error, category: 'validation' } }).screenshotTargetRestoration).toBeNull();
    expect(parse(envelope, 0).screenshotTargetRestoration).toBeNull();
  });
  it('retains only exact shader-source binding restoration proof', () => {
    const envelope = { schema_version: '3.0.0', result_kind: 'rd.shader.get_source', ok: false,
      error: { code: 'shader_binding_lookup_failed', category: 'runtime', message: 'No PS bound',
        details: { context_id: 'owned-context', session_id: 'native-replay', resolved_event_id: 3029,
          failure_stage: 'resolve_binding', failure_reason: 'stage_unbound',
          replay_state_restored: true, restored_event_id: 1248 } } };
    const parse = (value: object, exitCode = 1) => {
      try { parseRdcNativeResult({ exitCode, stdout: JSON.stringify(value), stderr: '' } as CLIResult,
        undefined, 'rd.shader.get_source'); } catch (error) { return error as RdcNativeFailure; }
      throw new Error('Expected native failure');
    };
    expect(parse(envelope).shaderSourceRestoration).toEqual({ contextId: 'owned-context', sessionId: 'native-replay', eventId: 1248 });
    for (const details of [
      { ...envelope.error.details, replay_state_restored: false },
      { ...envelope.error.details, failure_stage: 'compile' },
      { ...envelope.error.details, failure_reason: 'unknown' },
      { ...envelope.error.details, restored_event_id: 0 },
    ]) {
      expect(parse({ ...envelope, error: { ...envelope.error, details } }).shaderSourceRestoration).toBeNull();
    }
    expect(parse({ ...envelope, result_kind: 'rd.shader.get_disassembly' }).shaderSourceRestoration).toBeNull();
    expect(parse({ ...envelope, error: { ...envelope.error, code: 'shader_inspection_recovery_failed' } }).shaderSourceRestoration).toBeNull();
    expect(parse(envelope, 0).shaderSourceRestoration).toBeNull();
  });
  it.each([
    { schema_version: '2.0.0' }, { result_kind: 'rd.shader.other' }, { exitCode: 0 },
    { category: 'runtime' }, { replacement_attempted: true }, { context_preserved: false },
  ])('does not accept incomplete or conflicting no-replacement proof: %j', (change) => {
    const envelope = { schema_version: '3.0.0', result_kind: 'rd.shader.edit_and_replace', ok: false,
      error: { code: 'shader_replace_failed', category: 'validation', message: 'Failed',
        details: { replacement_attempted: false, context_preserved: true } } };
    const { exitCode = 1, ...fields } = change;
    const { category, replacement_attempted, context_preserved, ...top } = fields;
    Object.assign(envelope, top);
    if (category !== undefined) envelope.error.category = category;
    if (replacement_attempted !== undefined) envelope.error.details.replacement_attempted = replacement_attempted;
    if (context_preserved !== undefined) envelope.error.details.context_preserved = context_preserved;
    let failure: unknown;
    try { parseRdcNativeResult({ exitCode, stdout: JSON.stringify(envelope), stderr: '' } as CLIResult,
      undefined, 'rd.shader.edit_and_replace'); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(RdcNativeFailure);
    expect(failure).toMatchObject({ replacementNotAttempted: false });
  });
});
