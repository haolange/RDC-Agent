import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '../agent-runtime/agent/AgentTool';
import { DEFAULT_RDC_CLI_INVOKER } from '../settings/settingsDefaults';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
import type { RdcOperationDefinition } from '@shared/types/tool';
import { executeRdcShell, RdcShellInputSchema } from './executeRdcShell';
import { verifyRollbackIdentity } from './RdcValidatedEvidence';
const mock = vi.hoisted(() => ({ execute: vi.fn(), lease: vi.fn(), retainedLease: vi.fn(), prepare: vi.fn(), write: vi.fn(), quarantine: vi.fn(), observe: vi.fn() }));
vi.mock('../sessions', () => ({ rdcSessionService: { observeAgentOperation: mock.observe } }));
vi.mock('./RdcCliInvokerService', () => ({ rdcCliInvokerService: { executeCLI: mock.execute } }));
vi.mock('../sessions/RdcRuntimeContextRegistry', () => ({ assertRdcContextLeaseOwnership: mock.lease, getRdcContextLease: mock.retainedLease, quarantineRdcContext: mock.quarantine }));
vi.mock('./RdcExecutionReceipts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./RdcExecutionReceipts')>();
  return { ...original, rdcExecutionReceipts: { prepare: mock.prepare, write: mock.write } };
});
const definition: RdcOperationDefinition = { name: 'rd.perf.get_event_durations', namespace: 'perf', description: 'Measure event durations',
  input_schema: { type: 'object', properties: { session_id: { type: 'string' } }, required: ['session_id'], additionalProperties: false },
  scope: 'replay', effects: ['replay_position'], evidence_kind: 'measurement', path_inputs: [], prerequisites: [{ requires: 'session_id' }] };
const context: ToolExecutionContext = {
  workspaceRoot: '/project', projectRootPath: '/project', projectId: 'project', sessionId: 'session', turnId: 'turn',
  agentId: 'general', rdcBinding: freezeRdcTurnBinding({ ...DEFAULT_RDC_CLI_INVOKER,
    enabled: true, command: 'native-rdc', env: { FROZEN: 'yes' } }, [definition], { contextId: 'owned-context', version: 7, ownerSessionId: 'session', runtimeContext: { replaySessionId: 'native-replay', captureFileId: 'native-capture' } }),
};
const lease = { contextId: 'owned-context', version: 7, ownerProjectId: 'project', ownerSessionId: 'session',
  runtimeContext: { replaySessionId: 'native-replay', captureFileId: 'native-capture' } };
const input = { operation: 'rd.perf.get_event_durations', args: {}, experimentId: 'experiment' };
const processIdentity = { status: 'available', daemon: { pid: 31, start_generation: 'windows-filetime:100' },
  worker: { pid: 32, start_generation: 'windows-filetime:200' } };
beforeEach(() => {
  vi.clearAllMocks();
  mock.lease.mockReturnValue(lease);
  mock.retainedLease.mockReturnValue(null);
  mock.execute.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: input.operation,
    meta: { process_identity: processIdentity },
    data: { event_durations: [{ event_id: 11, duration_us: 2 }] } }) });
  mock.write.mockReturnValue({ uri: 'session://tool-outputs/receipt.json', expectedHash: 'sha256:abc' });
});

it('enumerates the complete frozen capability surface in hash-bound pages without native effects', async () => {
  expect(RdcShellInputSchema.parse({ discovery: { kind: 'list' } })).toEqual({ discovery: { kind: 'list', limit: 20 } });
  for (const discovery of [{ kind: 'list', query: 'hidden' }, { kind: 'list', limit: 21 },
    { kind: 'list', cursor: { offset: -1, fingerprint: 'a'.repeat(64) } },
    { kind: 'list', cursor: { offset: 0, fingerprint: 'invalid' } }]) {
    expect(() => RdcShellInputSchema.parse({ discovery })).toThrow();
  }
  const definitions = Array.from({ length: 22 }, (_, index) => ({ ...definition, name: `rd.perf.query_${index}` }));
  definitions.push({ ...definition, name: 'rd.buffer.write', effects: ['buffer_write'] });
  const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, definitions, lease) };
  const first = await executeRdcShell({ discovery: { kind: 'list', limit: 20 } }, 'page-1', undefined, bound);
  const page = JSON.parse((first.content[0] as { text: string }).text);
  expect(page.data).toMatchObject({ total: 23, offset: 0, truncated: true,
    capabilitySummary: { checkedOperations: 23, admittedOperations: 22, deniedOperations: 1, admittedEffects: ['replay_position'] },
    policy: { argumentChecksStillRequired: true, isAuthorization: false } });
  expect(page.data.operations).toHaveLength(20);
  const last = await executeRdcShell({ discovery: { kind: 'list', cursor: page.data.next, limit: 20 } }, 'page-2', undefined, bound);
  const tail = JSON.parse((last.content[0] as { text: string }).text);
  expect(tail.data).toMatchObject({ total: 23, offset: 20, truncated: false, next: null });
  expect([...page.data.operations, ...tail.data.operations].map((item: { name: string }) => item.name)).toEqual(definitions.map(item => item.name));
  expect(tail.data.operations.at(-1).capabilityAdmission).toMatchObject({ available: false });
  await expect(executeRdcShell({ discovery: { kind: 'list', limit: 20, cursor: { ...page.data.next, fingerprint: '0'.repeat(64) } } },
    'stale', undefined, bound)).rejects.toThrow(/fingerprint/);
  await expect(executeRdcShell({ discovery: { kind: 'list', limit: 20,
    cursor: { offset: 24, fingerprint: page.fingerprint } } }, 'out-of-range', undefined, bound)).rejects.toThrow(/offset/);
  await expect(executeRdcShell({ operation: 'rd.buffer.write', args: {} }, 'denied', undefined, bound)).rejects.toThrow(/capability/);
  expect(mock.execute).not.toHaveBeenCalled(); expect(mock.observe).not.toHaveBeenCalled(); expect(mock.write).not.toHaveBeenCalled();
});

it.each(['replay_fatal_error', 'replay_health_unavailable'])(
  'quarantines native %s without publishing default-zero evidence', async code => {
    const query: RdcOperationDefinition = { ...definition, name: 'rd.texture.get_pixel_value',
      namespace: 'texture', evidence_kind: null };
    const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [query], lease) };
    mock.execute.mockResolvedValueOnce({ exitCode: 1, stdout: JSON.stringify({ schema_version: '3.0.0',
      result_kind: query.name, ok: false, error: { code, category: 'runtime',
        message: 'Native replay health failed', details: { recovery_required: true,
          session_id: 'native-replay', failure_stage: 'after_operation' } } }) });
    await expect(executeRdcShell({ operation: query.name, args: {} }, 'fatal-read', undefined, bound))
      .rejects.toThrow(code);
    expect(mock.quarantine).toHaveBeenCalledTimes(1);
    expect(mock.write).not.toHaveBeenCalled();
    expect(mock.observe).not.toHaveBeenCalled();
  },
);
describe('structured RDC shell', () => {
  it('records the failed native preflight rather than claiming the requested shader call ran', async () => {
    const query: RdcOperationDefinition = { ...definition, name: 'rd.shader.get_source', namespace: 'shader', evidence_kind: null };
    const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [query], lease) };
    mock.execute.mockResolvedValueOnce({ exitCode: 1, stdout: JSON.stringify({ schema_version: '3.0.0',
      result_kind: 'rd.session.get_context', ok: false, error: { code: 'context_query_failed', category: 'runtime', message: 'No current native state' } }) });
    const failure = await executeRdcShell({ operation: query.name, args: {} }, 'preflight-failure', undefined, bound).catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.deliveryResult.details).toMatchObject({ operation: query.name,
      nativeFailure: { resultKind: 'rd.session.get_context', proof: {} },
      invocation: { operation: 'rd.session.get_context', args: {} },
      mainValidation: { preservationVerified: false, leaseState: 'quarantined' },
    });
    expect(mock.execute).toHaveBeenCalledOnce();
    expect(mock.execute.mock.calls[0]?.[1]?.[0]).toBe('rd.session.get_context');
    expect(mock.write).not.toHaveBeenCalled();
  });
  it('keeps the original failure invocation when its restoration verification also fails', async () => {
    const query: RdcOperationDefinition = { ...definition, name: 'rd.shader.get_source', namespace: 'shader', evidence_kind: null };
    const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [query], lease) };
    mock.execute.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rd.session.get_context',
      data: { context_id: 'owned-context', current_session_id: 'native-replay', runtime: { active_event_id: 11 } } }) });
    mock.execute.mockResolvedValueOnce({ exitCode: 1, stdout: JSON.stringify({ schema_version: '3.0.0',
      result_kind: query.name, ok: false, error: { code: 'shader_binding_lookup_failed', category: 'runtime', message: 'Stage unbound',
        details: { failure_stage: 'resolve_binding', failure_reason: 'stage_unbound', replay_state_restored: true,
          context_id: 'owned-context', session_id: 'native-replay', restored_event_id: 11 } } }) });
    mock.execute.mockResolvedValueOnce({ exitCode: 1, stdout: JSON.stringify({ schema_version: '3.0.0',
      result_kind: 'rd.session.get_context', ok: false, error: { code: 'context_query_failed', category: 'runtime', message: 'Cannot verify current state' } }) });
    const failure = await executeRdcShell({ operation: query.name, args: {} }, 'restore-check-failure', undefined, bound).catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.deliveryResult.details).toMatchObject({
      nativeFailure: { code: 'shader_binding_lookup_failed', resultKind: query.name, proof: {} },
      invocation: { operation: query.name, args: { session_id: 'native-replay' } },
      mainValidation: { preservationVerified: false, leaseState: 'quarantined' },
    });
    expect(mock.execute).toHaveBeenCalledTimes(3);
    expect(mock.quarantine).toHaveBeenCalledOnce();
    expect(mock.write).not.toHaveBeenCalled();
  });
  it('does not sign experimental evidence without live process-birth provenance', async () => {
    mock.execute.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true,
      result_kind: input.operation, meta: { process_identity: { status: 'unavailable', reason: 'process_birth_unavailable' } },
      data: { event_durations: [{ event_id: 11, duration_us: 2 }] } }) });
    await expect(executeRdcShell(input, 'missing-process', undefined, context)).rejects.toThrow(/RDC_PROCESS_IDENTITY_REQUIRED/);
    expect(mock.write).not.toHaveBeenCalled();
    expect(mock.quarantine).toHaveBeenCalled();
  });
  it('denies a fresh turn on a quarantined lease with explicit lifecycle recovery', async () => {
    mock.lease.mockReturnValue(null);
    mock.retainedLease.mockReturnValue({ ...lease, quarantineReason: 'native outcome uncertain' });
    const fresh = { ...context, turnId: 'next-turn',
      rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [definition], null) };
    await expect(executeRdcShell(input, 'call', undefined, fresh)).rejects.toThrow(/RDC_CONTEXT_QUARANTINED:.*close and reopen/);
    expect(mock.execute).not.toHaveBeenCalled();
    expect(mock.write).not.toHaveBeenCalled();
  });
  it('injects only native replay identity and frozen binding, then issues a main receipt', async () => {
    const result = await executeRdcShell(input, 'call', undefined, context);
    expect(mock.execute).toHaveBeenCalledWith('call', [
      input.operation, '--args-json', JSON.stringify({ session_id: 'native-replay' }), '--daemon-context', 'owned-context',
    ], expect.objectContaining({ settings: expect.objectContaining({ command: 'native-rdc', env: { FROZEN: 'yes' } }) }));
    expect(mock.write).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session', projectId: 'project', turnId: 'turn', toolCallId: 'call', experimentId: 'experiment',
      contextId: 'owned-context', replaySessionId: 'native-replay', exitCode: 0,
    }), undefined);
    const text = JSON.parse((result.content[0] as { text: string }).text) as { rdcExecutionIdentity: Record<string, string> };
    expect(text.rdcExecutionIdentity).toEqual({
      productSessionId: 'session', contextId: 'owned-context', replaySessionId: 'native-replay', captureFileId: 'native-capture',
    });
    expect(result.details).toMatchObject({ rdcExecutionIdentity: text.rdcExecutionIdentity });
    expect(JSON.parse((result.content[0] as { text: string }).text).invocation).toMatchObject({
      kind: 'main-validated-cli-arguments', operation: input.operation, args: { session_id: 'native-replay' },
    });
    expect(result.details).toMatchObject({ invocation: { args: { session_id: 'native-replay' }, argsFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) } });
  });
  it.each(['debugger', 'analyzer', 'optimizer', 'custom'])('denies %s even with a valid lease', async (agentId) => {
    await expect(executeRdcShell(input, 'call', undefined, { ...context, agentId })).rejects.toThrow(/DENIED/);
    expect(mock.execute).not.toHaveBeenCalled();
  });
  it('denies offline children and foreign/default contexts', async () => {
    await expect(executeRdcShell(input, 'call', undefined, { ...context, excludeRdcLeaseTools: true })).rejects.toThrow();
    for (const invalid of [null, { ...lease, ownerProjectId: 'foreign' }, { ...lease, contextId: 'default' }, { ...lease, delegatedFrom: 'parent' }]) {
      mock.lease.mockReturnValue(invalid);
      await expect(executeRdcShell(input, 'call', undefined, context)).rejects.toThrow();
    }
    expect(mock.execute).not.toHaveBeenCalled();
  });
  it.each(['session_id', 'context_id', 'daemon_context'])('rejects model supplied %s', async (key) => {
    await expect(executeRdcShell({ ...input, args: { [key]: 'foreign' } }, 'call', undefined, context)).rejects.toThrow(/main-owned/);
    expect(mock.execute).not.toHaveBeenCalled();
  });
  it.each([
    { exitCode: 124, stdout: '{}' }, { exitCode: 1, stdout: '{"ok":true}' },
    { exitCode: 0, stdout: '' }, { exitCode: 0, stdout: '{"ok":false}' },
  ])('does not issue a receipt after failure %j', async (result) => {
    mock.execute.mockResolvedValue(result);
    await expect(executeRdcShell(input, 'call', undefined, context)).rejects.toThrow();
    expect(mock.write).not.toHaveBeenCalled();
    expect(mock.quarantine).toHaveBeenCalledWith('session', 7, expect.stringContaining('uncertain'));
  });
  it.each(['shader_patch_op_unsupported_for_encoding', 'shader_patch_diff_failed'])('keeps the owning lease usable after canonical %s before shader replacement', async code => {
    const replacement: RdcOperationDefinition = { ...definition, name: 'rd.shader.edit_and_replace', namespace: 'shader',
      effects: ['shader_replacement', 'replay_position', 'artifact_write'], evidence_kind: 'intervention' };
    const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [replacement], lease) };
    mock.execute.mockResolvedValueOnce({ exitCode: 1, stdout: JSON.stringify({ schema_version: '3.0.0',
      result_kind: replacement.name, ok: false, error: { code,
        category: 'validation', message: 'Source encoding is not safely editable',
        details: { replacement_attempted: false, context_preserved: true } } }) });
    await expect(executeRdcShell({ operation: replacement.name, args: {}, experimentId: 'exp' }, 'edit', undefined, bound))
      .rejects.toThrow(code);
    expect(mock.quarantine).not.toHaveBeenCalled();
    expect(mock.write).not.toHaveBeenCalled();
    const discovery = await executeRdcShell({ discovery: { kind: 'describe', operation: replacement.name } }, 'next', undefined, bound);
    expect(discovery.details).toMatchObject({ exitCode: 0 });
    expect(mock.execute).toHaveBeenCalledTimes(1);
  });
  it('permits a native query after a rejected diff without signing an intervention or restarting the replay', async () => {
    const replacement: RdcOperationDefinition = { ...definition, name: 'rd.shader.edit_and_replace', namespace: 'shader',
      effects: ['shader_replacement', 'replay_position'], evidence_kind: 'intervention' };
    const query: RdcOperationDefinition = { ...definition, name: 'rd.event.get_active', namespace: 'event', effects: [], evidence_kind: null };
    const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [replacement, query], lease) };
    mock.execute.mockResolvedValueOnce({ exitCode: 1, stdout: JSON.stringify({ schema_version: '3.0.0',
      result_kind: replacement.name, ok: false, error: { code: 'shader_patch_diff_failed', category: 'validation',
        message: 'Diff removal does not match', details: { failure_stage: 'apply_patch', replacement_attempted: false, context_preserved: true } } }) });
    await expect(executeRdcShell({ operation: replacement.name, args: {}, experimentId: 'exp' }, 'bad-diff', undefined, bound))
      .rejects.toThrow('shader_patch_diff_failed');
    mock.execute.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: query.name,
      data: { session_id: 'native-replay', active_event_id: 1248 } }) });
    await expect(executeRdcShell({ operation: query.name, args: {} }, 'read', undefined, bound)).resolves.toBeDefined();
    expect(mock.execute).toHaveBeenCalledTimes(2);
    expect(mock.quarantine).not.toHaveBeenCalled();
    expect(mock.write).not.toHaveBeenCalled();
    expect(mock.observe).not.toHaveBeenCalled();
  });
  it('delivers an unchanged shader result without an intervention receipt and keeps the owning replay usable', async () => {
    const replacement: RdcOperationDefinition = { ...definition, name: 'rd.shader.edit_and_replace', namespace: 'shader',
      effects: ['shader_replacement', 'replay_position'], evidence_kind: 'intervention' };
    const query: RdcOperationDefinition = { ...definition, name: 'rd.event.get_active', namespace: 'event', effects: [], evidence_kind: null };
    const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [replacement, query], lease) };
    const hash = 'a'.repeat(64);
    const data = { replacement_id: 'not-applied', status: 'noop', resolved_event_id: 7,
      replacement: { replacement_id: 'not-applied', status: 'noop', resolved_event_id: 7,
        original_shader_id: 'ResourceId::9', original_shader_hash: hash, applied_to_shader_hash: hash,
        compile: { build_input: { status: 'unavailable', reason: 'No successful shader build and replacement observed.' } } } };
    mock.execute.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ schema_version: '3.0.0',
      ok: true, result_kind: replacement.name, meta: { process_identity: processIdentity }, data }) });
    const result = await executeRdcShell({ operation: replacement.name, args: {}, experimentId: 'noop-exp' }, 'noop', undefined, bound);
    expect(JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '')).toMatchObject({ result: { data },
      executionEvidence: { status: 'not-executed', reason: 'native-shader-noop', receiptIssued: false } });
    expect(result.details?.receipt).toBeUndefined();
    expect(mock.write).not.toHaveBeenCalled();
    expect(mock.quarantine).not.toHaveBeenCalled();
    expect(mock.observe).toHaveBeenCalledOnce();
    expect(() => verifyRollbackIdentity({ ...replacement, evidence_kind: 'rollback' },
      { replacement_id: 'not-applied' }, 'owned-context', 'noop-exp')).toThrow(/host-verified intervention/);
    mock.execute.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: query.name,
      data: { session_id: 'native-replay', active_event_id: 7 } }) });
    await expect(executeRdcShell({ operation: query.name, args: {} }, 'follow-up', undefined, bound)).resolves.toBeDefined();
  });
  it.each(['status', 'id', 'event', 'hash', 'build', 'lease', 'observe', 'cancel'])(
    'does not trust an unchanged shader result with invalid %s', async failure => {
      const replacement: RdcOperationDefinition = { ...definition, name: 'rd.shader.edit_and_replace', namespace: 'shader',
        effects: ['shader_replacement', 'replay_position'], evidence_kind: 'intervention' };
      const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [replacement], lease) };
      const data = { replacement_id: 'untrusted-noop', status: 'noop', resolved_event_id: 7,
        replacement: { replacement_id: 'untrusted-noop', status: 'noop', resolved_event_id: 7,
          original_shader_id: 'ResourceId::9', original_shader_hash: 'a'.repeat(64), applied_to_shader_hash: 'a'.repeat(64),
          compile: { build_input: { status: 'unavailable' } } } };
      if (failure === 'status') data.replacement.status = 'applied';
      if (failure === 'id') data.replacement.replacement_id = 'different';
      if (failure === 'event') data.replacement.resolved_event_id = 8;
      if (failure === 'hash') data.replacement.applied_to_shader_hash = 'b'.repeat(64);
      if (failure === 'build') data.replacement.compile.build_input.status = 'available';
      if (failure === 'lease') mock.lease.mockReturnValueOnce(lease).mockReturnValueOnce(lease).mockReturnValueOnce({ ...lease, version: 8 });
      if (failure === 'observe') mock.observe.mockRejectedValueOnce(new Error('observation failed'));
      const controller = new AbortController();
      mock.execute.mockImplementationOnce(async () => {
        if (failure === 'cancel') controller.abort();
        return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: replacement.name, data }) };
      });
      await expect(executeRdcShell({ operation: replacement.name, args: {}, experimentId: 'untrusted-noop-exp' },
        'noop', controller.signal, bound)).rejects.toThrow();
      expect(mock.quarantine).toHaveBeenCalledOnce();
      expect(mock.write).not.toHaveBeenCalled();
    });
  it('keeps the owning replay usable after a proven pre-effect validation rejection', async () => {
    const query: RdcOperationDefinition = { ...definition, name: 'rd.pipeline.get_state', namespace: 'pipeline',
      effects: ['replay_position'], evidence_kind: null };
    const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [query], lease) };
    mock.execute.mockResolvedValueOnce({ exitCode: 1, stdout: JSON.stringify({ schema_version: '3.0.0',
      result_kind: query.name, ok: false, error: { code: 'unsupported_target', category: 'validation',
        message: 'Target unavailable', details: { effects_attempted: false, context_preserved: true } } }) });
    await expect(executeRdcShell({ operation: query.name, args: {} }, 'invalid', undefined, bound))
      .rejects.toThrow(/unsupported_target/);
    expect(mock.quarantine).not.toHaveBeenCalled();
    await expect(executeRdcShell({ discovery: { kind: 'describe', operation: query.name } }, 'next', undefined, bound))
      .resolves.toBeDefined();
    expect(mock.write).not.toHaveBeenCalled();
  });
  it.each([true, false])('requires explicit pre-effect proof for a mesh resource miss: %s', async proven => {
    const query: RdcOperationDefinition = { ...definition, name: 'rd.mesh.decode_index_data', namespace: 'mesh', evidence_kind: null };
    const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [query], lease) };
    mock.execute.mockResolvedValueOnce({ exitCode: 1, stdout: JSON.stringify({ schema_version: '3.0.0',
      result_kind: query.name, ok: false, error: { code: 'resource_not_found', category: 'validation',
        message: 'Resource not found', details: { session_id: 'native-replay', failure_stage: 'resolve_buffer', private_path: 'private native diagnostic',
          ...(proven ? { effects_attempted: false, context_preserved: true } : {}) } } }) });
    const failure = await executeRdcShell({ operation: query.name, args: {} }, 'missing-resource', undefined, bound)
      .catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toMatch(/resource_not_found/);
    expect(failure.deliveryResult).toMatchObject({ isError: true, details: {
      operation: query.name, exitCode: 1,
      mainValidation: { preservationVerified: proven, leaseState: proven ? 'retained' : 'quarantined' },
      nativeFailure: { code: 'resource_not_found', category: 'validation',
        proof: proven ? { effects_attempted: false, context_preserved: true } : {} },
      rdcExecutionIdentity: { productSessionId: 'session', contextId: 'owned-context', replaySessionId: 'native-replay', captureFileId: 'native-capture' },
    } });
    const delivered = JSON.parse(failure.deliveryResult.content[0].text);
    expect(delivered).toMatchObject({ ok: false, source: 'main-qualified-native-failure' });
    expect(delivered.nativeFailure).toEqual(failure.deliveryResult.details.nativeFailure);
    expect(delivered.mainValidation).toEqual(failure.deliveryResult.details.mainValidation);
    expect(failure.deliveryResult.details).not.toHaveProperty('receipt');
    expect(JSON.stringify(failure.deliveryResult)).not.toMatch(/private_path|private native diagnostic/);
    expect(mock.quarantine).toHaveBeenCalledTimes(proven ? 0 : 1);
    expect(mock.write).not.toHaveBeenCalled();
    expect(mock.observe).not.toHaveBeenCalled();
    if (proven) {
      mock.execute.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: query.name,
        data: { indices: [2, 3, 5] } }) });
      await expect(executeRdcShell({ operation: query.name, args: {} }, 'next-read', undefined, bound)).resolves.toBeDefined();
      expect(mock.execute).toHaveBeenCalledTimes(2);
      expect(mock.quarantine).not.toHaveBeenCalled();
    }
  });
  it.each([
    { category: 'validation', proof: true, safe: true },
    { category: 'validation', proof: false, safe: false },
    { category: 'runtime', proof: true, safe: false },
    { category: 'runtime', proof: false, safe: false },
  ])('qualifies a resource details miss: category=$category proof=$proof', async ({ category, proof, safe }) => {
    const query: RdcOperationDefinition = { ...definition, name: 'rd.resource.get_details', namespace: 'resource',
      effects: [], evidence_kind: null, input_schema: { type: 'object',
        properties: { session_id: { type: 'string' }, resource_id: { type: 'string' } },
        required: ['session_id', 'resource_id'], additionalProperties: false } };
    const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [query], lease) };
    mock.execute.mockResolvedValueOnce({ exitCode: 1, stdout: JSON.stringify({ schema_version: '3.0.0',
      result_kind: query.name, ok: false, error: { code: 'resource_not_found', category,
        message: 'Resource not found', details: { session_id: 'native-replay', failure_stage: 'resolve_resource',
          ...(proof ? { effects_attempted: false, context_preserved: true } : {}) } } }) });
    const args = { resource_id: '9007199254741021' };
    const failure = await executeRdcShell({ operation: query.name, args }, 'details-miss', undefined, bound).catch(error => error);
    expect(failure.deliveryResult).toMatchObject({ isError: true, details: {
      operation: query.name, mainValidation: { preservationVerified: safe, leaseState: safe ? 'retained' : 'quarantined' },
      nativeFailure: { code: 'resource_not_found', category,
        proof: safe ? { effects_attempted: false, context_preserved: true } : {} },
      invocation: { args: { resource_id: args.resource_id, session_id: 'native-replay' } },
    } });
    expect(mock.quarantine).toHaveBeenCalledTimes(safe ? 0 : 1);
    expect(mock.write).not.toHaveBeenCalled();
    expect(mock.observe).not.toHaveBeenCalled();
    if (safe) {
      mock.execute.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: query.name,
        data: { details: { resource_id: 'ResourceId::9007199254741021', width: 8 } } }) });
      await expect(executeRdcShell({ operation: query.name, args }, 'next-details', undefined, bound)).resolves.toBeDefined();
      expect(mock.execute).toHaveBeenCalledTimes(2);
    }
  });
  it('quarantines a pre-effect claim when the owning lease changed', async () => {
    const query: RdcOperationDefinition = { ...definition, name: 'rd.pipeline.get_state', namespace: 'pipeline',
      effects: ['replay_position'], evidence_kind: null };
    const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [query], lease) };
    mock.lease.mockReturnValueOnce(lease).mockReturnValueOnce(lease).mockReturnValueOnce({ ...lease, version: 8 });
    mock.execute.mockResolvedValueOnce({ exitCode: 1, stdout: JSON.stringify({ schema_version: '3.0.0',
      result_kind: query.name, ok: false, error: { code: 'unsupported_target', category: 'validation',
        message: 'Target unavailable', details: { effects_attempted: false, context_preserved: true } } }) });
    const failure = await executeRdcShell({ operation: query.name, args: {} }, 'invalid', undefined, bound).catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.deliveryResult).toMatchObject({ isError: true, details: {
      mainValidation: { preservationVerified: false, leaseState: 'quarantined' }, nativeFailure: { proof: {} },
    } });
    expect(failure.deliveryResult.details.nativeFailure.proof).not.toHaveProperty('context_preserved');
    expect(mock.quarantine).toHaveBeenCalledWith('session', 7, expect.stringContaining('uncertain'));
  });
  it('quarantines when a no-replacement error cannot be tied to the unchanged owning lease', async () => {
    const replacement: RdcOperationDefinition = { ...definition, name: 'rd.shader.edit_and_replace', namespace: 'shader',
      effects: ['shader_replacement', 'replay_position'], evidence_kind: 'intervention' };
    const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [replacement], lease) };
    mock.lease.mockReturnValueOnce(lease).mockReturnValueOnce(lease).mockReturnValueOnce({ ...lease, version: 8 });
    mock.execute.mockResolvedValueOnce({ exitCode: 1, stdout: JSON.stringify({ schema_version: '3.0.0',
      result_kind: replacement.name, ok: false, error: { code: 'shader_patch_op_unsupported_for_encoding',
        category: 'validation', message: 'Source encoding is not safely editable',
        details: { replacement_attempted: false, context_preserved: true } } }) });
    await expect(executeRdcShell({ operation: replacement.name, args: {} }, 'edit', undefined, bound)).rejects.toThrow();
    expect(mock.quarantine).toHaveBeenCalledWith('session', 7, expect.stringContaining('uncertain'));
  });
  it('does not issue a receipt if cancelled or ownership changes while running', async () => {
    const controller = new AbortController();
    mock.execute.mockImplementationOnce(async () => { controller.abort(); return { exitCode: 0, stdout: '{}' }; });
    await expect(executeRdcShell(input, 'call', controller.signal, context)).rejects.toThrow();
    mock.lease.mockReturnValueOnce(lease).mockReturnValueOnce({ ...lease, version: 8 });
    await expect(executeRdcShell(input, 'call', undefined, context)).rejects.toThrow(/changed/);
    expect(mock.write).not.toHaveBeenCalled();
  });
  it('fails before native mutation when trusted storage is unavailable', async () => {
    mock.prepare.mockImplementationOnce(() => { throw new Error('safeStorage unavailable'); });
    await expect(executeRdcShell(input, 'call', undefined, context)).rejects.toThrow(/safeStorage/);
    expect(mock.execute).not.toHaveBeenCalled();
  });
  it('does not persist ordinary native queries without an experiment binding', async () => {
    await executeRdcShell({ operation: input.operation, args: {} }, 'call', undefined, context);
    expect(mock.prepare).not.toHaveBeenCalled();
    expect(mock.write).not.toHaveBeenCalled();
  });
  it('accepts only exact session-scoped native operation syntax', () => {
    for (const operation of ['rdXshaderXedit_and_replace', 'rd.shader.edit_and_replace;exit']) {
      expect(RdcShellInputSchema.safeParse({ operation, args: {} }).success).toBe(false);
    }
  });
});

 it.each([
   { result_kind: 'rd.shader.edit_and_replace', data: {} },
   { result_kind: 'rd.perf.get_event_durations', data: { session_id: 'foreign' } },
 ])('refuses operation/replay mismatch before signing', async (payload) => {
   mock.execute.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ ok: true, ...payload }) });
   await expect(executeRdcShell(input, 'call', undefined, context)).rejects.toThrow(/mismatch|result_kind/);
   expect(mock.write).not.toHaveBeenCalled();
 });

it('rejects using a newly rebound identity in an old prepared turn before invoking native code', async () => {
  mock.lease.mockReturnValue({ ...lease, version: 8 });
  await expect(executeRdcShell(input, 'call', undefined, context)).rejects.toThrow(/prepare/);
  expect(mock.execute).not.toHaveBeenCalled();
  expect(mock.quarantine).not.toHaveBeenCalled();
});

it('observes performance output only after native measurement and durable receipt complete with frozen CLI', async () => {
  const order: string[] = [];
  mock.execute.mockImplementationOnce(async () => { order.push('measure'); return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: input.operation, meta: { process_identity: processIdentity }, data: { event_durations: [{ event_id: 11, duration_us: 2 }] } }) }; });
  mock.write.mockImplementationOnce(() => { order.push('receipt'); return undefined; });
  mock.observe.mockImplementationOnce(async () => { order.push('observe'); });
  await executeRdcShell(input, 'call', undefined, context);
  expect(order).toEqual(['measure', 'receipt', 'observe']);
  expect(mock.observe).toHaveBeenCalledWith({ projectId: 'project', sessionId: 'session' }, input.operation, 'call', context.rdcBinding?.cli, true);
});

it('returns a read-only native query without a second replay observation', async () => {
  const query: RdcOperationDefinition = {
    ...definition, name: 'rd.event.get_active', namespace: 'event',
    effects: [], evidence_kind: null,
  };
  const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [query], lease) };
  mock.execute.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({
    ok: true, result_kind: query.name, data: { active_event_id: 1248 },
  }) });
  await executeRdcShell({ operation: query.name, args: {} }, 'read', undefined, bound);
  expect(mock.execute).toHaveBeenCalledTimes(1);
  expect(mock.observe).not.toHaveBeenCalled();
  expect(mock.write).not.toHaveBeenCalled();
});

it('holds one native transaction through observation so concurrent commands cannot change the recorded event', async () => {
  const order: string[] = []; let release!: () => void;
  mock.execute.mockImplementation(async () => { order.push('native'); return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: input.operation, meta: { process_identity: processIdentity }, data: { event_durations: [{ event_id: 11, duration_us: 2 }] } }) }; });
  mock.observe.mockImplementationOnce(() => new Promise<void>(resolve => { order.push('observe-start'); release = resolve; }));
  const first = executeRdcShell(input, 'first', undefined, context);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const second = executeRdcShell(input, 'second', undefined, context);
  await Promise.resolve(); expect(order).toEqual(['native', 'observe-start']);
  release(); await Promise.all([first, second]);
  expect(order).toEqual(['native', 'observe-start', 'native']);
});

it('discovers from frozen definitions without CLI execution or receipts', async () => {
  const result = await executeRdcShell({ discovery: { kind: 'search', query: 'durations', limit: 8 } }, 'find', undefined, context);
  expect(JSON.stringify(result)).toContain(definition.name); expect(mock.execute).not.toHaveBeenCalled(); expect(mock.write).not.toHaveBeenCalled();
  const described = await executeRdcShell({ discovery: { kind: 'describe', operation: definition.name } }, 'describe', undefined, context);
  const payload = JSON.parse((described.content[0] as { text: string }).text) as { fingerprint: string; data: {
    input_schema: { properties: Record<string, unknown>; required: string[] }; host_supplied_identity: string[];
  } };
  expect(payload.fingerprint).toBe(context.rdcBinding!.definitionsFingerprint);
  expect(payload.data.input_schema.properties).not.toHaveProperty('session_id');
  expect(payload.data.input_schema.required).not.toContain('session_id');
  expect(payload.data.host_supplied_identity).toEqual(['session_id']);
  expect(definition.input_schema.properties).toHaveProperty('session_id');
});
it('ranks the named native export above a loosely described output operation', async () => {
  const exportTexture: RdcOperationDefinition = {
    ...definition, name: 'rd.export.texture', namespace: 'export',
    description: '导出纹理；省略显示控制时使用原生 SaveTexture。',
    returns_raw: 'native PNG image_width image_height',
  };
  const observe: RdcOperationDefinition = {
    ...definition, name: 'rd.session.observe', namespace: 'session',
    description: 'Apply an event and export its texture native output image.',
  };
  const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [observe, exportTexture], lease) };
  const result = await executeRdcShell({ discovery: { kind: 'search', query: 'export texture native', limit: 2 } }, 'find', undefined, bound);
  const payload = JSON.parse((result.content[0] as { text: string }).text) as { data: { matches: Array<{ name: string }>; total: number } };
  expect(payload.data.matches.map(item => item.name)).toEqual(['rd.export.texture', 'rd.session.observe']);
  expect(payload.data.total).toBe(2);
  expect(mock.execute).not.toHaveBeenCalled();
});
it('discovers experiment evidence capabilities from the frozen catalog without executing native operations', async () => {
  const ordinary: RdcOperationDefinition = { ...definition, name: 'rd.texture.get_pixel_value', namespace: 'texture', description: 'Read a pixel', evidence_kind: null };
  const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [ordinary, definition], lease) };
  const result = await executeRdcShell({ discovery: { kind: 'search', query: 'measurement', limit: 8 } }, 'find', undefined, bound);
  const payload = JSON.parse((result.content[0] as { text: string }).text);
  expect(payload.data.matches).toEqual([expect.objectContaining({ name: definition.name, evidence_kind: 'measurement' })]);
  expect(mock.execute).not.toHaveBeenCalled();
  expect(mock.write).not.toHaveBeenCalled();
});
it('explains unsupported experiment evidence before any native effect and retains the lease', async () => {
  const ordinary: RdcOperationDefinition = { ...definition, name: 'rd.texture.get_pixel_value', namespace: 'texture', evidence_kind: null };
  const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [ordinary], lease) };
  await expect(executeRdcShell({ operation: ordinary.name, args: {}, experimentId: 'experiment' }, 'read', undefined, bound))
    .rejects.toThrow(/no native operation was executed.*frozen catalog.*receipt.uri\/expectedHash/);
  expect(mock.execute).not.toHaveBeenCalled();
  expect(mock.write).not.toHaveBeenCalled();
  expect(mock.quarantine).not.toHaveBeenCalled();
});
it('keeps partial catalog matches visible when a broad query spans two operation names', async () => {
  const actions: RdcOperationDefinition = { ...definition, name: 'rd.event.get_action_details', namespace: 'event', description: '读取事件详情' };
  const pipeline: RdcOperationDefinition = { ...definition, name: 'rd.pipeline.get_state', namespace: 'pipeline', description: '读取管线状态' };
  const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [actions, pipeline], lease) };
  const result = await executeRdcShell({ discovery: { kind: 'search', query: 'action details pipeline state', limit: 8 } }, 'find', undefined, bound);
  const payload = JSON.parse((result.content[0] as { text: string }).text) as { data: { matches: Array<{ name: string }>; total: number } };
  expect(payload.data.matches.map(item => item.name)).toEqual(['rd.event.get_action_details', 'rd.pipeline.get_state']);
  expect(payload.data.total).toBe(2);
});
it.each(['rd.session.clear_context', 'rd.texture.invented'])('rejects unknown or unauthorized %s before execution', async operation => {
  await expect(executeRdcShell({ operation, args: {} }, 'call', undefined, context)).rejects.toThrow(/DENIED/);
  expect(mock.execute).not.toHaveBeenCalled(); expect(mock.quarantine).not.toHaveBeenCalled();
});
it('rejects fake measurement success rather than signing zero/empty evidence', async () => {
  mock.execute.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: input.operation, data: { duration_ms: 0 } }) });
  await expect(executeRdcShell(input, 'call', undefined, context)).rejects.toThrow(/EVIDENCE_INVALID/); expect(mock.write).not.toHaveBeenCalled();
});

it.each([11, 12])('verifies temporary replay restoration against context, after=%s', async afterEvent => {
  const query: RdcOperationDefinition = { ...definition, name: 'rd.buffer.get_data',
    effects: ['replay_position_temporary'], evidence_kind: null };
  const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [query], lease) };
  const snapshot = (event: number) => ({ exitCode: 0, stdout: JSON.stringify({ ok: true,
    result_kind: 'rd.session.get_context', data: { context_id: lease.contextId,
      current_session_id: 'native-replay', runtime: { active_event_id: event } } }) });
  mock.execute.mockReset();
  mock.execute.mockResolvedValueOnce(snapshot(11)).mockResolvedValueOnce({ exitCode: 0,
    stdout: JSON.stringify({ ok: true, result_kind: query.name, data: {
      session_id: 'native-replay', replay_state_restored: true, restored_event_id: 11 } })
  }).mockResolvedValueOnce(snapshot(afterEvent));
  const result = executeRdcShell({ operation: query.name, args: {} }, 'read', undefined, bound);
  if (afterEvent === 11) {
    await expect(result).resolves.toBeDefined();
    expect(mock.quarantine).not.toHaveBeenCalled();
  } else {
    await expect(result).rejects.toThrow(/restoration/);
    expect(mock.quarantine).toHaveBeenCalled();
  }
  expect(mock.execute).toHaveBeenCalledTimes(3);
  expect(mock.observe).not.toHaveBeenCalled();
  expect(mock.write).not.toHaveBeenCalled();
});

it.each([
  { after: 11, proofEvent: 11, quarantined: false },
  { after: 12, proofEvent: 11, quarantined: true },
  { after: 11, proofEvent: 12, quarantined: true },
])('verifies failed screenshot target restoration against the owning replay: %j', async ({ after, proofEvent, quarantined }) => {
  const screenshot: RdcOperationDefinition = { ...definition, name: 'rd.export.screenshot', namespace: 'export',
    effects: ['replay_position', 'artifact_write'], evidence_kind: null };
  const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [screenshot], lease) };
  const snapshot = (event: number) => ({ exitCode: 0, stdout: JSON.stringify({ ok: true,
    result_kind: 'rd.session.get_context', data: { context_id: lease.contextId,
      current_session_id: 'native-replay', runtime: { active_event_id: event } } }) });
  mock.execute.mockReset();
  mock.execute.mockResolvedValueOnce(snapshot(11)).mockResolvedValueOnce({ exitCode: 1,
    stdout: JSON.stringify({ schema_version: '3.0.0', result_kind: screenshot.name, ok: false,
      error: { code: 'preview_event_output_unavailable', category: 'runtime', message: 'No target',
        details: { context_id: lease.contextId, session_id: 'native-replay', failure_stage: 'resolve_visual_target',
          replay_state_restored: true, restored_event_id: proofEvent, artifact_write_attempted: false } } })
  }).mockResolvedValueOnce(snapshot(after));
  await expect(executeRdcShell({ operation: screenshot.name, args: {} }, 'shot', undefined, bound))
    .rejects.toThrow(/preview_event_output_unavailable/);
  expect(mock.quarantine).toHaveBeenCalledTimes(quarantined ? 1 : 0);
  expect(mock.write).not.toHaveBeenCalled();
  expect(mock.execute).toHaveBeenCalledTimes(proofEvent === 11 ? 3 : 2);
});

it.each([
  { after: 1248, proofEvent: 1248, quarantined: false },
  { after: 3029, proofEvent: 1248, quarantined: true },
  { after: 1248, proofEvent: 3029, quarantined: true },
])('verifies failed shader-source binding restoration against the owning replay: %j', async ({ after, proofEvent, quarantined }) => {
  const source: RdcOperationDefinition = { ...definition, name: 'rd.shader.get_source', namespace: 'shader',
    input_schema: { type: 'object', properties: { session_id: { type: 'string' }, event_id: { type: 'integer' } },
      required: ['session_id'], additionalProperties: false },
    effects: ['replay_position'], evidence_kind: null };
  const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [source], lease) };
  const snapshot = (event: number) => ({ exitCode: 0, stdout: JSON.stringify({ ok: true,
    result_kind: 'rd.session.get_context', data: { context_id: lease.contextId,
      current_session_id: 'native-replay', runtime: { active_event_id: event } } }) });
  mock.execute.mockReset();
  mock.execute.mockResolvedValueOnce(snapshot(1248)).mockResolvedValueOnce({ exitCode: 1,
    stdout: JSON.stringify({ schema_version: '3.0.0', result_kind: source.name, ok: false,
      error: { code: 'shader_binding_lookup_failed', category: 'runtime', message: 'No PS bound',
        details: { context_id: lease.contextId, session_id: 'native-replay', resolved_event_id: 3029,
          failure_stage: 'resolve_binding', failure_reason: 'stage_unbound',
          replay_state_restored: true, restored_event_id: proofEvent } } })
  }).mockResolvedValueOnce(snapshot(after));
  await expect(executeRdcShell({ operation: source.name, args: { event_id: 3029 } }, 'source', undefined, bound))
    .rejects.toThrow(/shader_binding_lookup_failed/);
  expect(mock.quarantine).toHaveBeenCalledTimes(quarantined ? 1 : 0);
  expect(mock.write).not.toHaveBeenCalled();
  expect(mock.execute).toHaveBeenCalledTimes(proofEvent === 1248 ? 3 : 2);
});

it.each([false, true])('retains the lease after stale-debug rejection only with no native effects: %s', async (effectsAttempted) => {
  const debug: RdcOperationDefinition = { ...definition, name: 'rd.shader.get_debug_state', namespace: 'shader', evidence_kind: null };
  const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [debug], lease) };
  mock.execute.mockReset();
  mock.execute.mockResolvedValue({ exitCode: 1, stdout: JSON.stringify({ schema_version: '3.0.0',
    result_kind: debug.name, ok: false, error: { code: 'shader_debug_handle_invalid', category: 'validation',
      message: 'Stale debugger handle', details: { effects_attempted: effectsAttempted, context_preserved: true } } }) });
  await expect(executeRdcShell({ operation: debug.name, args: {} }, 'debug', undefined, bound))
    .rejects.toThrow(/shader_debug_handle_invalid/);
  expect(mock.execute).toHaveBeenCalledTimes(1);
  expect(mock.quarantine).toHaveBeenCalledTimes(effectsAttempted ? 1 : 0);
  expect(mock.write).not.toHaveBeenCalled();
});

it.each([
  { after: 11, proofEvent: 11, contextId: 'owned-context', sessionId: 'native-replay', quarantined: false },
  { after: 12, proofEvent: 11, contextId: 'owned-context', sessionId: 'native-replay', quarantined: true },
  { after: 11, proofEvent: 12, contextId: 'owned-context', sessionId: 'native-replay', quarantined: true },
  { after: 11, proofEvent: 11, contextId: 'foreign', sessionId: 'native-replay', quarantined: true },
  { after: 11, proofEvent: 11, contextId: 'owned-context', sessionId: 'foreign', quarantined: true },
])('verifies constant-buffer failure restoration without issuing evidence: %j', async ({ after, proofEvent, contextId, sessionId, quarantined }) => {
  const buffer: RdcOperationDefinition = { ...definition, name: 'rd.shader.get_constant_buffer_contents', namespace: 'shader',
    input_schema: { type: 'object', properties: { session_id: { type: 'string' }, event_id: { type: 'integer' } },
      required: ['session_id'], additionalProperties: false }, effects: ['replay_position'], evidence_kind: null };
  const bound = { ...context, rdcBinding: freezeRdcTurnBinding(context.rdcBinding!.cli, [buffer], lease) };
  const snapshot = (event: number) => ({ exitCode: 0, stdout: JSON.stringify({ ok: true,
    result_kind: 'rd.session.get_context', data: { context_id: lease.contextId,
      current_session_id: 'native-replay', runtime: { active_event_id: event } } }) });
  mock.execute.mockReset();
  mock.execute.mockResolvedValueOnce(snapshot(11)).mockResolvedValueOnce({ exitCode: 1,
    stdout: JSON.stringify({ schema_version: '3.0.0', result_kind: buffer.name, ok: false,
      error: { code: 'constant_buffer_data_unavailable', category: 'runtime', message: 'No buffer data',
        details: { context_id: contextId, session_id: sessionId, failure_stage: 'decode_constant_buffer',
          failure_reason: 'slot_unavailable', replay_state_restored: true, restored_event_id: proofEvent } } })
  }).mockResolvedValueOnce(snapshot(after));
  await expect(executeRdcShell({ operation: buffer.name, args: { event_id: 19 } }, 'buffer', undefined, bound))
    .rejects.toThrow(/constant_buffer_data_unavailable/);
  expect(mock.quarantine).toHaveBeenCalledTimes(quarantined ? 1 : 0);
  expect(mock.write).not.toHaveBeenCalled();
  expect(mock.observe).not.toHaveBeenCalled();
});
