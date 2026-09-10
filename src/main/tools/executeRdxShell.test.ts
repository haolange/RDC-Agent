import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '../agent-runtime/agent/AgentTool';
import { DEFAULT_RDX_ACTIONS, DEFAULT_RDX_CLI_INVOKER } from '../settings/settingsDefaults';
import { freezeRdxTurnBinding } from './RdxTurnBindings';
import { executeRdxShell, RdxShellInputSchema } from './executeRdxShell';
const mock = vi.hoisted(() => ({ execute: vi.fn(), lease: vi.fn(), prepare: vi.fn(), write: vi.fn(), quarantine: vi.fn() }));
vi.mock('./RdxCliInvokerService', () => ({ rdxCliInvokerService: { executeCLI: mock.execute } }));
vi.mock('../sessions/RdxRuntimeContextRegistry', () => ({ assertRdxContextLeaseOwnership: mock.lease, quarantineRdxContext: mock.quarantine }));
vi.mock('./RdxExecutionReceipts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./RdxExecutionReceipts')>();
  return { ...original, rdxExecutionReceipts: { prepare: mock.prepare, write: mock.write } };
});
const context: ToolExecutionContext = {
  workspaceRoot: '/project', projectRootPath: '/project', projectId: 'project', sessionId: 'session', turnId: 'turn',
  agentId: 'general', rdxBinding: freezeRdxTurnBinding({ ...DEFAULT_RDX_CLI_INVOKER,
    enabled: true, command: 'native-rdx', env: { FROZEN: 'yes' } }, DEFAULT_RDX_ACTIONS, { contextId: 'owned-context', version: 7, ownerSessionId: 'session' }),
};
const lease = { contextId: 'owned-context', version: 7, ownerProjectId: 'project', ownerSessionId: 'session',
  runtimeContext: { replaySessionId: 'native-replay' } };
const input = { operation: 'rd.perf.get_frame_timing', args: {}, experimentId: 'experiment' };
beforeEach(() => {
  vi.clearAllMocks();
  mock.lease.mockReturnValue(lease);
  mock.execute.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: input.operation, data: { duration_ms: 2 } }) });
  mock.write.mockReturnValue({ uri: 'session://tool-outputs/receipt.json', expectedHash: 'sha256:abc' });
});
describe('structured RDX shell', () => {
  it('injects only native replay identity and frozen binding, then issues a main receipt', async () => {
    await executeRdxShell(input, 'call', undefined, context);
    expect(mock.execute).toHaveBeenCalledWith('call', [
      input.operation, '--args-json', JSON.stringify({ session_id: 'native-replay' }), '--daemon-context', 'owned-context',
    ], expect.objectContaining({ settings: expect.objectContaining({ command: 'native-rdx', env: { FROZEN: 'yes' } }) }));
    expect(mock.write).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session', projectId: 'project', turnId: 'turn', toolCallId: 'call', experimentId: 'experiment',
      contextId: 'owned-context', replaySessionId: 'native-replay', exitCode: 0,
    }), undefined);
  });
  it.each(['debugger', 'analyzer', 'optimizer', 'custom'])('denies %s even with a valid lease', async (agentId) => {
    await expect(executeRdxShell(input, 'call', undefined, { ...context, agentId })).rejects.toThrow(/DENIED/);
    expect(mock.execute).not.toHaveBeenCalled();
  });
  it('denies offline children and foreign/default contexts', async () => {
    await expect(executeRdxShell(input, 'call', undefined, { ...context, excludeRdxLeaseTools: true })).rejects.toThrow();
    for (const invalid of [null, { ...lease, ownerProjectId: 'foreign' }, { ...lease, contextId: 'default' }, { ...lease, delegatedFrom: 'parent' }]) {
      mock.lease.mockReturnValue(invalid);
      await expect(executeRdxShell(input, 'call', undefined, context)).rejects.toThrow();
    }
    expect(mock.execute).not.toHaveBeenCalled();
  });
  it.each(['session_id', 'context_id', 'daemon_context'])('rejects model supplied %s', async (key) => {
    await expect(executeRdxShell({ ...input, args: { [key]: 'foreign' } }, 'call', undefined, context)).rejects.toThrow(/main-owned/);
    expect(mock.execute).not.toHaveBeenCalled();
  });
  it.each([
    { exitCode: 124, stdout: '{}' }, { exitCode: 1, stdout: '{"ok":true}' },
    { exitCode: 0, stdout: '' }, { exitCode: 0, stdout: '{"ok":false}' },
  ])('does not issue a receipt after failure %j', async (result) => {
    mock.execute.mockResolvedValue(result);
    await expect(executeRdxShell(input, 'call', undefined, context)).rejects.toThrow();
    expect(mock.write).not.toHaveBeenCalled();
    expect(mock.quarantine).toHaveBeenCalledWith('session', 7, expect.stringContaining('uncertain'));
  });
  it('does not issue a receipt if cancelled or ownership changes while running', async () => {
    const controller = new AbortController();
    mock.execute.mockImplementationOnce(async () => { controller.abort(); return { exitCode: 0, stdout: '{}' }; });
    await expect(executeRdxShell(input, 'call', controller.signal, context)).rejects.toThrow();
    mock.lease.mockReturnValueOnce(lease).mockReturnValueOnce({ ...lease, version: 8 });
    await expect(executeRdxShell(input, 'call', undefined, context)).rejects.toThrow(/changed/);
    expect(mock.write).not.toHaveBeenCalled();
  });
  it('fails before native mutation when trusted storage is unavailable', async () => {
    mock.prepare.mockImplementationOnce(() => { throw new Error('safeStorage unavailable'); });
    await expect(executeRdxShell(input, 'call', undefined, context)).rejects.toThrow(/safeStorage/);
    expect(mock.execute).not.toHaveBeenCalled();
  });
  it('does not persist ordinary native queries without an experiment binding', async () => {
    await executeRdxShell({ operation: input.operation, args: {} }, 'call', undefined, context);
    expect(mock.prepare).not.toHaveBeenCalled();
    expect(mock.write).not.toHaveBeenCalled();
  });
  it('accepts only exact session-scoped native operation syntax', () => {
    for (const operation of ['rdXshaderXedit_and_replace', 'rd.session.close', 'rd.core.init', 'rd.shader.edit_and_replace;exit']) {
      expect(RdxShellInputSchema.safeParse({ operation, args: {} }).success).toBe(false);
    }
  });
});

 it.each([
   { result_kind: 'rd.shader.edit_and_replace', data: {} },
   { result_kind: 'rd.perf.get_frame_timing', data: { session_id: 'foreign' } },
 ])('refuses operation/replay mismatch before signing', async (payload) => {
   mock.execute.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ ok: true, ...payload }) });
   await expect(executeRdxShell(input, 'call', undefined, context)).rejects.toThrow(/mismatch/);
   expect(mock.write).not.toHaveBeenCalled();
 });

it('rejects using a newly rebound identity in an old prepared turn before invoking native code', async () => {
  mock.lease.mockReturnValue({ ...lease, version: 8 });
  await expect(executeRdxShell(input, 'call', undefined, context)).rejects.toThrow(/prepare/);
  expect(mock.execute).not.toHaveBeenCalled();
  expect(mock.quarantine).not.toHaveBeenCalled();
});
