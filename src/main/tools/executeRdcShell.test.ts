import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '../agent-runtime/agent/AgentTool';
import { DEFAULT_RDC_CLI_INVOKER } from '../settings/settingsDefaults';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
import type { RdcOperationDefinition } from '@shared/types/tool';
import { executeRdcShell, RdcShellInputSchema } from './executeRdcShell';
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
beforeEach(() => {
  vi.clearAllMocks();
  mock.lease.mockReturnValue(lease);
  mock.retainedLease.mockReturnValue(null);
  mock.execute.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: input.operation, data: { event_durations: [{ event_id: 11, duration_us: 2 }] } }) });
  mock.write.mockReturnValue({ uri: 'session://tool-outputs/receipt.json', expectedHash: 'sha256:abc' });
});
describe('structured RDC shell', () => {
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
    await executeRdcShell(input, 'call', undefined, context);
    expect(mock.execute).toHaveBeenCalledWith('call', [
      input.operation, '--args-json', JSON.stringify({ session_id: 'native-replay' }), '--daemon-context', 'owned-context',
    ], expect.objectContaining({ settings: expect.objectContaining({ command: 'native-rdc', env: { FROZEN: 'yes' } }) }));
    expect(mock.write).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session', projectId: 'project', turnId: 'turn', toolCallId: 'call', experimentId: 'experiment',
      contextId: 'owned-context', replaySessionId: 'native-replay', exitCode: 0,
    }), undefined);
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
  mock.execute.mockImplementationOnce(async () => { order.push('measure'); return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: input.operation, data: { event_durations: [{ event_id: 11, duration_us: 2 }] } }) }; });
  mock.write.mockImplementationOnce(() => { order.push('receipt'); return undefined; });
  mock.observe.mockImplementationOnce(async () => { order.push('observe'); });
  await executeRdcShell(input, 'call', undefined, context);
  expect(order).toEqual(['measure', 'receipt', 'observe']);
  expect(mock.observe).toHaveBeenCalledWith({ projectId: 'project', sessionId: 'session' }, input.operation, 'call', context.rdcBinding?.cli, true);
});

it('holds one native transaction through observation so concurrent commands cannot change the recorded event', async () => {
  const order: string[] = []; let release!: () => void;
  mock.execute.mockImplementation(async () => { order.push('native'); return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: input.operation, data: { event_durations: [{ event_id: 11, duration_us: 2 }] } }) }; });
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
  expect(JSON.stringify(described)).toContain('input_schema');
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
