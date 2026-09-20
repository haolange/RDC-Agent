import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenProjectInputRequest } from '@shared/types/session';
const nativeStop = vi.hoisted(() => vi.fn());
vi.mock('../tools/RdcCliInvokerService', () => ({ rdcCliInvokerService: { executeCLI: nativeStop, loadCatalog: vi.fn(async () => ({ tools: [] })) } }));
vi.mock('../settings/SettingsService', () => ({ settingsService: { getAll: () => ({ tooling: { rdcCli: { enabled: true, command: 'rdc', argsPrefix: [], env: {} } } }) } }));
vi.mock('../captures/ReplayDeviceService', () => ({ replayDeviceService: {} }));
vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }));
vi.mock('../tools/ShellInvocationService', () => ({ shellInvocationService: { hasUnconfirmedProcesses: () => false } }));
const ownership = vi.hoisted(() => ({ remember: vi.fn(), forget: vi.fn() }));
vi.mock('./OwnedRdcDaemonRegistry', () => ({ rememberOwnedRdcDaemon: ownership.remember, forgetOwnedRdcDaemon: ownership.forget }));
import { rdcCliInvokerService } from '../tools/RdcCliInvokerService';
import { freezeRdcTurnBinding } from '../tools/RdcTurnBindings';
import { RdcSessionRuntime } from './RdcSessionRuntime';
import { clearRdcContextLeases, getRdcContextLease, grantDelegatedLease, revokeDelegatedLease } from './RdcRuntimeContextRegistry';
const request: OpenProjectInputRequest = { projectId: 'project', sessionId: 'session', inputId: 'same-file', filePath: '/capture.rdc',
  replayDevice: { id: 'local', type: 'local', label: 'Local', transport: 'local', status: 'online' } };
const scope = { projectId: 'project', sessionId: 'session' };
beforeEach(() => { clearRdcContextLeases(); ownership.remember.mockReset(); ownership.forget.mockReset(); nativeStop.mockReset(); nativeStop.mockImplementation(async (_command: string, args: string[]) => {
  const operation = args[0];
  const context = args[args.lastIndexOf('--daemon-context') + 1] ?? 'default';
  if (_command === 'daemon' && operation === 'start') {
    return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rdc_tool.daemon.start', data: {
      context_id: context, owner_pid: process.pid, state: { context_id: context, owner_pid: process.pid, pid: 4242, worker: { pid: 0 } },
    } }) };
  }
  const data = _command === 'daemon' ? { context_id: context, stopped: true }
    : operation === 'rd.capture.open_file' ? { context_id: context, capture_file_id: 'file' }
    : operation === 'rd.capture.open_replay' ? { context_id: context, session_id: 'replay', capture_file_id: 'file' }
      : operation === 'rd.session.clear_context' ? { context_id: context } : {};
  return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: _command === 'daemon' ? 'rdc_tool.daemon.stop' : operation, data }) };
}); });
describe('native owning runtime', () => {
  it('loads the cached catalog and skips refresh when a frozen binding is supplied', async () => {
    const loadCatalog = vi.mocked(rdcCliInvokerService.loadCatalog);
    loadCatalog.mockClear();
    await new RdcSessionRuntime().openProjectInput(request);
    expect(loadCatalog).toHaveBeenCalledWith(expect.objectContaining({ command: 'rdc' }));
    expect(loadCatalog.mock.calls.every((call) => call[1] !== true)).toBe(true);
    loadCatalog.mockClear();
    const binding = freezeRdcTurnBinding({
      enabled: true, command: 'rdc', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 30_000,
    }, []);
    await new RdcSessionRuntime().openProjectInput(request, { binding });
    expect(loadCatalog).not.toHaveBeenCalled();
  });
  it('fails closed when daemon start does not bind the application owner', async () => {
    nativeStop.mockImplementation(async (_command: string, args: string[]) => {
      const context = args[args.lastIndexOf('--daemon-context') + 1] ?? 'default';
      if (_command === 'daemon' && args[0] === 'start') {
        return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rdc_tool.daemon.start', data: {
          context_id: context, owner_pid: 1, state: { context_id: context, owner_pid: 1, pid: 4242 },
        } }) };
      }
      return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: args[0], data: { context_id: context } }) };
    });
    await expect(new RdcSessionRuntime().openProjectInput(request)).rejects.toThrow('owner_pid');
    expect(ownership.remember).not.toHaveBeenCalled();
    expect(getRdcContextLease('session')).toBeNull();
  });
  it('allocates a unique context rather than using input identity', async () => {
    const runtime = new RdcSessionRuntime(); const opened = await runtime.openProjectInput(request);
    expect(opened.contextId).toMatch(/^rdc-/); expect(opened.contextId).not.toBe(request.inputId);
    expect(getRdcContextLease('session')?.contextId).toBe(opened.contextId);
    expect(nativeStop).toHaveBeenCalledWith('daemon', ['start', '--daemon-context', opened.contextId], expect.objectContaining({ contextId: opened.contextId }));
    expect(ownership.remember).toHaveBeenCalledWith(expect.objectContaining({ contextId: opened.contextId, ownerPid: process.pid }));
  });
  it('retains partial-open context until explicit confirmed close', async () => {
    nativeStop.mockImplementation(async (_command: string, args: string[]) => {
      const context = args[args.lastIndexOf('--daemon-context') + 1] ?? 'default';
      if (_command === 'daemon' && args[0] === 'start') {
        return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rdc_tool.daemon.start', data: {
          context_id: context, owner_pid: process.pid, state: { context_id: context, owner_pid: process.pid, pid: 4242 },
        } }) };
      }
      if (args[0] === 'rd.capture.open_file') return { exitCode: 1, stdout: '', stderr: 'open outcome uncertain' };
      return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: _command === 'daemon' ? 'rdc_tool.daemon.stop' : args[0], data: { context_id: context, stopped: true } }) };
    });
    const runtime = new RdcSessionRuntime(); await expect(runtime.openProjectInput(request)).rejects.toThrow('CLI_FAILED');
    const contextId = runtime.getContextId(); expect(contextId).toMatch(/^rdc-/);
    nativeStop.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'close failed' });
    await expect(runtime.clearOpenedCaptureForSession(scope)).rejects.toThrow('CLOSE_FAILED');
    expect(runtime.getContextId()).toBe(contextId);
    await runtime.clearOpenedCaptureForSession(scope); expect(runtime.getContextId()).toBeNull();
  });
  it('rejects a native operation returning a foreign context', async () => {
    nativeStop.mockImplementation(async (_command: string, args: string[]) => {
      const context = args[args.lastIndexOf('--daemon-context') + 1] ?? 'default';
      if (_command === 'daemon' && args[0] === 'start') {
        return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rdc_tool.daemon.start', data: {
          context_id: context, owner_pid: process.pid, state: { context_id: context, owner_pid: process.pid, pid: 4242 },
        } }) };
      }
      return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rd.capture.open_file', data: { context_id: 'foreign', session_id: 'replay', capture_file_id: 'file' } }) };
    });
    const runtime = new RdcSessionRuntime(); await expect(runtime.openProjectInput(request)).rejects.toThrow('CONTEXT_MISMATCH');
    expect(getRdcContextLease('session')).toBeNull();
    expect(runtime.getContextId()).not.toBe('foreign');
  });
  it('does not clear other session lease when a fresh runtime closes', async () => {
    const runtime = new RdcSessionRuntime(); await runtime.openProjectInput(request);
    const fresh = new RdcSessionRuntime(); await fresh.closeOrReplaceOpenedCapture();
    expect(getRdcContextLease('session')).not.toBeNull();
  });
  it('requires delegated execution to join before teardown', async () => {
    const runtime = new RdcSessionRuntime(); await runtime.openProjectInput(request);
    grantDelegatedLease({ parentSessionId: 'session', childSessionId: 'child', projectId: 'project', ownerTurnId: 'turn' });
    await expect(runtime.clearOpenedCaptureForSession(scope)).rejects.toThrow('DUAL_OWNER');
    revokeDelegatedLease('child');
    await runtime.clearOpenedCaptureForSession(scope);
  });
});

it('retains ownership when daemon stop fails after replay clear', async () => {
  const runtime = new RdcSessionRuntime(); await runtime.openProjectInput(request);
  const id = runtime.getContextId();
  nativeStop.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rd.session.clear_context', data: { context_id: id } }) });
  nativeStop.mockResolvedValueOnce({ exitCode: 1, stdout: '' });
  await expect(runtime.clearOpenedCaptureForSession(scope)).rejects.toThrow('FAILED');
  expect(runtime.getContextId()).toBe(id); expect(getRdcContextLease('session')).not.toBeNull();
  await runtime.clearOpenedCaptureForSession(scope);
  expect(runtime.getContextId()).toBeNull();
  expect(nativeStop).toHaveBeenCalledWith('daemon', ['stop', '--daemon-context', id], expect.objectContaining({ contextId: id }));
  expect(ownership.forget).toHaveBeenCalledWith(id);
});

it('rejects wrong-context clear without stopping any daemon', async () => {
  const runtime = new RdcSessionRuntime(); await runtime.openProjectInput(request);
  const id = runtime.getContextId(); nativeStop.mockClear();
  nativeStop.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rd.session.clear_context', data: { context_id: 'other' } }) });
  await expect(runtime.clearOpenedCaptureForSession(scope)).rejects.toThrow();
  expect(nativeStop).toHaveBeenCalledTimes(1);
  expect(runtime.getContextId()).toBe(id);
  expect(getRdcContextLease('session')?.contextId).toBe(id);
});
it('rejects unconfirmed daemon stop and preserves owning lease', async () => {
  const runtime = new RdcSessionRuntime(); await runtime.openProjectInput(request);
  const id = runtime.getContextId();
  nativeStop.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rd.session.clear_context', data: { context_id: id } }) });
  nativeStop.mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rdc_tool.daemon.stop', data: { context_id: id } }) });
  await expect(runtime.clearOpenedCaptureForSession(scope)).rejects.toThrow();
  expect(getRdcContextLease('session')?.contextId).toBe(id);
});
it('does not commit a native open completed after cancellation', async () => {
  const controller = new AbortController();
  nativeStop.mockImplementation(async (_command: string, args: string[]) => {
    const context = args[args.lastIndexOf('--daemon-context') + 1] ?? 'default';
    if (_command === 'daemon' && args[0] === 'start') {
      return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rdc_tool.daemon.start', data: {
        context_id: context, owner_pid: process.pid, state: { context_id: context, owner_pid: process.pid, pid: 4242 },
      } }) };
    }
    controller.abort();
    return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rd.capture.open_file', data: { context_id: args.at(-1), capture_file_id: 'file' } }) };
  });
  const runtime = new RdcSessionRuntime();
  await expect(runtime.openProjectInput(request, { signal: controller.signal })).rejects.toThrow();
  expect(getRdcContextLease('session')).toBeNull();
  expect(runtime.getContextId()).toMatch(/^rdc-/);
});
