import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenProjectInputRequest } from '@shared/types/session';
const nativeStop = vi.hoisted(() => vi.fn());
vi.mock('../tools/RdxCliInvokerService', () => ({ rdxCliInvokerService: { executeCLI: nativeStop, loadCatalog: vi.fn(async () => ({ tools: [] })) } }));
vi.mock('../settings/SettingsService', () => ({ settingsService: { getAll: () => ({ tooling: { rdxCli: { enabled: true, command: 'rdx', argsPrefix: [], env: {} } } }) } }));
vi.mock('../captures/ReplayDeviceService', () => ({ replayDeviceService: {} }));
vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }));
vi.mock('../tools/ShellInvocationService', () => ({ shellInvocationService: { hasUnconfirmedProcesses: () => false } }));
import { rdxCliInvokerService } from '../tools/RdxCliInvokerService';
import { freezeRdxTurnBinding } from '../tools/RdxTurnBindings';
import { RdxSessionRuntime } from './RdxSessionRuntime';
import { clearRdxContextLeases, getRdxContextLease, grantDelegatedLease, revokeDelegatedLease } from './RdxRuntimeContextRegistry';
const request: OpenProjectInputRequest = { projectId: 'project', sessionId: 'session', inputId: 'same-file', filePath: '/capture.rdc',
  replayDevice: { id: 'local', type: 'local', label: 'Local', transport: 'local', status: 'online' } };
const scope = { projectId: 'project', sessionId: 'session' };
beforeEach(() => { clearRdxContextLeases(); nativeStop.mockReset(); nativeStop.mockImplementation(async (_command: string, args: string[]) => {
  const operation = args[0];
  const context = args[args.lastIndexOf('--daemon-context') + 1] ?? 'default';
  const data = _command === 'daemon' ? { context_id: context, stopped: true }
    : operation === 'rd.capture.open_file' ? { context_id: context, capture_file_id: 'file' }
    : operation === 'rd.capture.open_replay' ? { context_id: context, session_id: 'replay', capture_file_id: 'file' }
      : operation === 'rd.session.clear_context' ? { context_id: context } : {};
  return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: _command === 'daemon' ? 'rdx.daemon.stop' : operation, data }) };
}); });
describe('native owning runtime', () => {
  it('loads the cached catalog and skips refresh when a frozen binding is supplied', async () => {
    const loadCatalog = vi.mocked(rdxCliInvokerService.loadCatalog);
    loadCatalog.mockClear();
    await new RdxSessionRuntime().openProjectInput(request);
    expect(loadCatalog).toHaveBeenCalledWith(expect.objectContaining({ command: 'rdx' }));
    expect(loadCatalog.mock.calls.every((call) => call[1] !== true)).toBe(true);
    loadCatalog.mockClear();
    const binding = freezeRdxTurnBinding({
      enabled: true, command: 'rdx', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 30_000,
    }, []);
    await new RdxSessionRuntime().openProjectInput(request, { binding });
    expect(loadCatalog).not.toHaveBeenCalled();
  });
  it('allocates a unique context rather than using input identity', async () => {
    const runtime = new RdxSessionRuntime(); const opened = await runtime.openProjectInput(request);
    expect(opened.contextId).toMatch(/^rdc-/); expect(opened.contextId).not.toBe(request.inputId);
    expect(getRdxContextLease('session')?.contextId).toBe(opened.contextId);
  });
  it('retains partial-open context until explicit confirmed close', async () => {
    nativeStop.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'open outcome uncertain' });
    const runtime = new RdxSessionRuntime(); await expect(runtime.openProjectInput(request)).rejects.toThrow('CLI_FAILED');
    const contextId = runtime.getContextId(); expect(contextId).toMatch(/^rdc-/);
    nativeStop.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'close failed' });
    await expect(runtime.clearOpenedCaptureForSession(scope)).rejects.toThrow('CLOSE_FAILED');
    expect(runtime.getContextId()).toBe(contextId);
    await runtime.clearOpenedCaptureForSession(scope); expect(runtime.getContextId()).toBeNull();
  });
  it('rejects a native operation returning a foreign context', async () => {
    nativeStop.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rd.capture.open_file', data: { context_id: 'foreign', session_id: 'replay', capture_file_id: 'file' } }) });
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
  nativeStop.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rd.session.clear_context', data: { context_id: id } }) });
  nativeStop.mockResolvedValueOnce({ exitCode: 1, stdout: '' });
  await expect(runtime.clearOpenedCaptureForSession(scope)).rejects.toThrow('FAILED');
  expect(runtime.getContextId()).toBe(id); expect(getRdxContextLease('session')).not.toBeNull();
  await runtime.clearOpenedCaptureForSession(scope);
  expect(runtime.getContextId()).toBeNull();
  expect(nativeStop).toHaveBeenCalledWith('daemon', ['stop', '--daemon-context', id], expect.objectContaining({ contextId: id }));
});

it('rejects wrong-context clear without stopping any daemon', async () => {
  const runtime = new RdxSessionRuntime(); await runtime.openProjectInput(request);
  const id = runtime.getContextId(); nativeStop.mockClear();
  nativeStop.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rd.session.clear_context', data: { context_id: 'other' } }) });
  await expect(runtime.clearOpenedCaptureForSession(scope)).rejects.toThrow();
  expect(nativeStop).toHaveBeenCalledTimes(1);
  expect(runtime.getContextId()).toBe(id);
  expect(getRdxContextLease('session')?.contextId).toBe(id);
});
it('rejects unconfirmed daemon stop and preserves owning lease', async () => {
  const runtime = new RdxSessionRuntime(); await runtime.openProjectInput(request);
  const id = runtime.getContextId();
  nativeStop.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rd.session.clear_context', data: { context_id: id } }) });
  nativeStop.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rdx.daemon.stop', data: { context_id: id } }) });
  await expect(runtime.clearOpenedCaptureForSession(scope)).rejects.toThrow();
  expect(getRdxContextLease('session')?.contextId).toBe(id);
});
it('does not commit a native open completed after cancellation', async () => {
  const controller = new AbortController();
  nativeStop.mockImplementationOnce(async (_command: string, args: string[]) => {
    controller.abort();
    return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rd.capture.open_file', data: { context_id: args.at(-1), capture_file_id: 'file' } }) };
  });
  const runtime = new RdxSessionRuntime();
  await expect(runtime.openProjectInput(request, { signal: controller.signal })).rejects.toThrow();
  expect(getRdxContextLease('session')).toBeNull();
  expect(runtime.getContextId()).toMatch(/^rdc-/);
});
