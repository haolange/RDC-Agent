import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenProjectInputRequest } from '@shared/types/session';
const nativeStop = vi.hoisted(() => vi.fn());
vi.mock('../tools/RdxCliInvokerService', () => ({ rdxCliInvokerService: { executeCLI: nativeStop } }));
vi.mock('../settings/SettingsService', () => ({ settingsService: { getAll: () => ({ tooling: { rdxCli: { enabled: true, command: 'rdx', argsPrefix: [], env: {} }, rdxActions: {} } }) } }));
const runAction = vi.hoisted(() => vi.fn());
vi.mock('../tools/RdxShellActionService', () => ({ rdxShellActionService: { runAction }, formatRdxActionDiagnostic: () => '', isLocalReplayUnsupportedDiagnostic: () => false }));
vi.mock('../captures/ReplayDeviceService', () => ({ replayDeviceService: {} }));
vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }));
vi.mock('../tools/ShellInvocationService', () => ({ shellInvocationService: { hasUnconfirmedProcesses: () => false } }));
import { RdxSessionRuntime } from './RdxSessionRuntime';
import { clearRdxContextLeases, getRdxContextLease, grantDelegatedLease, revokeDelegatedLease } from './RdxRuntimeContextRegistry';
const request: OpenProjectInputRequest = { projectId: 'project', sessionId: 'session', inputId: 'same-file', filePath: '/capture.rdc',
  replayDevice: { id: 'local', type: 'local', label: 'Local', transport: 'local', status: 'online' } };
const scope = { projectId: 'project', sessionId: 'session' };
beforeEach(() => { clearRdxContextLeases(); nativeStop.mockReset(); nativeStop.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rdx.daemon.stop', data: {} }) }); runAction.mockReset(); runAction.mockImplementation(async (action, variables) => ({ ok: true,
  data: action === 'openCapture' ? { context_id: variables.contextId, session_id: 'replay', capture_file_id: 'file' } : {} })); });
describe('native owning runtime', () => {
  it('allocates a unique context rather than using input identity', async () => {
    const runtime = new RdxSessionRuntime(); const opened = await runtime.openProjectInput(request);
    expect(opened.contextId).toMatch(/^rdc-/); expect(opened.contextId).not.toBe(request.inputId);
    expect(getRdxContextLease('session')?.contextId).toBe(opened.contextId);
    expect(runAction).toHaveBeenCalledTimes(1);
  });
  it('retains partial-open context until explicit confirmed close', async () => {
    runAction.mockResolvedValueOnce({ ok: false, error: 'open outcome uncertain' });
    const runtime = new RdxSessionRuntime(); await expect(runtime.openProjectInput(request)).rejects.toThrow('uncertain');
    const contextId = runtime.getContextId(); expect(contextId).toMatch(/^rdc-/);
    runAction.mockResolvedValueOnce({ ok: false, error: 'close failed' });
    await expect(runtime.clearOpenedCaptureForSession(scope)).rejects.toThrow('CLOSE_FAILED');
    expect(runtime.getContextId()).toBe(contextId);
    await runtime.clearOpenedCaptureForSession(scope); expect(runtime.getContextId()).toBeNull();
  });
  it('rejects configured action returning a foreign context', async () => {
    runAction.mockResolvedValueOnce({ ok: true, data: { context_id: 'foreign', session_id: 'replay' } });
    const runtime = new RdxSessionRuntime(); await expect(runtime.openProjectInput(request)).rejects.toThrow('CONTEXT_MISMATCH');
    expect(getRdxContextLease('session')).toBeNull();
    expect(runtime.getContextId()).not.toBe('foreign');
  });
  it('does not clear other session lease when a fresh runtime closes', async () => {
    const runtime = new RdxSessionRuntime(); await runtime.openProjectInput(request);
    const fresh = new RdxSessionRuntime(); await fresh.closeOrReplaceOpenedCapture();
    expect(getRdxContextLease('session')).not.toBeNull();
  });
  it('requires delegated execution to join before teardown', async () => {
    const runtime = new RdxSessionRuntime(); await runtime.openProjectInput(request);
    grantDelegatedLease({ parentSessionId: 'session', childSessionId: 'child', projectId: 'project', ownerTurnId: 'turn' });
    await expect(runtime.clearOpenedCaptureForSession(scope)).rejects.toThrow('DUAL_OWNER');
    revokeDelegatedLease('child');
    await runtime.clearOpenedCaptureForSession(scope);
  });
});

it('retains ownership when daemon stop fails after replay clear', async () => {
  const runtime = new RdxSessionRuntime(); await runtime.openProjectInput(request);
  const id = runtime.getContextId();
  nativeStop.mockResolvedValueOnce({ exitCode: 1, stdout: '' });
  await expect(runtime.clearOpenedCaptureForSession(scope)).rejects.toThrow('FAILED');
  expect(runtime.getContextId()).toBe(id); expect(getRdxContextLease('session')).not.toBeNull();
  await runtime.clearOpenedCaptureForSession(scope);
  expect(runtime.getContextId()).toBeNull();
  expect(nativeStop).toHaveBeenCalledWith('daemon', ['stop', '--daemon-context', id], expect.objectContaining({ contextId: id }));
});
