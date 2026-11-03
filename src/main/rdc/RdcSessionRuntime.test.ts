import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenProjectInputRequest } from '@shared/types/session';
const nativeStop = vi.hoisted(() => vi.fn());
vi.mock('./RdcCliInvokerService', () => ({ rdcCliInvokerService: { executeCLI: nativeStop, loadCatalog: vi.fn(async () => ({ tools: [] })) } }));
vi.mock('../settings/settings-core/SettingsService', () => ({ settingsService: { getAll: () => ({ tooling: { rdcCli: { enabled: true, command: 'rdc', argsPrefix: [], env: {} } } }) } }));
vi.mock('./captures/ReplayDeviceService', () => ({ replayDeviceService: {} }));
vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }));
vi.mock('../tools/ShellInvocationService', () => ({ shellInvocationService: { hasUnconfirmedProcesses: () => false } }));
const ownership = vi.hoisted(() => ({ remember: vi.fn(), forget: vi.fn() }));
vi.mock('./OwnedRdcDaemonRegistry', () => ({ rememberOwnedRdcDaemon: ownership.remember, forgetOwnedRdcDaemon: ownership.forget }));
import { rdcCliInvokerService } from './RdcCliInvokerService';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
import { RdcSessionRuntime } from './RdcSessionRuntime';
import { remotePreparationBindingIdentity } from './RdcRemoteConnection';
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
  it('shows the native cleanup reason and retains the lease when context release fails', async () => {
    const runtime = new RdcSessionRuntime(); await runtime.openProjectInput(request);
    const contextId = runtime.getContextId(); nativeStop.mockClear();
    nativeStop.mockResolvedValueOnce({ exitCode: 1, stdout: JSON.stringify({ ok: false, error: {
      code: 'context_cleanup_failed', message: 'Context cleanup failed',
      details: { cleanup_reason_code: 'expired_remote_cleanup_failed', cleanup_errors: ['private device details'] },
    } }) });
    await expect(runtime.clearOpenedCaptureForSession(scope)).rejects.toThrow('cleanup: expired_remote_cleanup_failed');
    expect(runtime.getContextId()).toBe(contextId);
    expect(getRdcContextLease('session')?.contextId).toBe(contextId);
    expect(nativeStop).toHaveBeenCalledTimes(1);
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

const remoteDevice: OpenProjectInputRequest['replayDevice'] = { id: 'android-PHONE', type: 'android', label: 'Phone', transport: 'adb_android', status: 'online', adbState: 'device', serial: 'PHONE' };
const remoteBinding = () => freezeRdcTurnBinding({ enabled: true, command: 'rdc', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 30000 }, [
  { name: 'rd.remote.connect', timeout_policy: { argument: 'timeout_ms', default_timeout_ms: 200000, worker_grace_ms: 85000, transport_grace_ms: 5000, process_grace_ms: 5000 }, input_schema: { properties: { timeout_ms: { type: 'integer' }, options: { properties: { repair_policy: { enum: ['auto_safe', 'confirmed'] }, repair_confirmation: { properties: { fingerprint: { type: 'string' } } } } } } } },
  { name: 'rd.remote.inspect_installation', scope: 'global', effects: [], input_schema: { properties: { device_serial: { type: 'string' } } } },
]);
function remoteNative() {
  nativeStop.mockImplementation(async (command: string, args: string[]) => {
    const context = args[args.lastIndexOf('--daemon-context') + 1]; const operation = args[0];
    const parsed = command === 'call' ? JSON.parse(args[args.indexOf('--args-json') + 1]) : {};
    const data = command === 'daemon' && operation === 'start' ? { context_id: context, owner_pid: process.pid, state: { context_id: context, pid: 4242 } }
      : command === 'daemon' ? { context_id: context, stopped: true }
        : operation === 'rd.remote.connect' ? { context_id: context, remote_id: 'remote', server_info: { bootstrap: { package_name: 'helper' } } }
          : operation === 'rd.capture.open_file' ? { context_id: context, capture_file_id: 'file' }
            : operation === 'rd.capture.open_replay' ? { context_id: context, session_id: 'replay', capture_file_id: 'file', remote_id: parsed.options.remote_id }
              : { context_id: context, alive: true };
    return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: command === 'daemon' ? 'rdc_tool.daemon.' + operation : operation, data }) };
  });
}
describe('selected remote before opening a capture', () => {
  it('rejects changed native identity before installation inspection starts a daemon', async () => {
    const runtime = new RdcSessionRuntime();
    await expect(runtime.inspectReplayDeviceInstallation(scope, remoteDevice, { binding: remoteBinding(), expectedBindingIdentity: 'changed' })).rejects.toThrow('CONFIRMATION_STALE');
    expect(nativeStop).not.toHaveBeenCalled();
  });
  it('uses an owning context for read-only verification without connecting or granting a capture lease', async () => {
    remoteNative(); const native = nativeStop.getMockImplementation()!; const binding = remoteBinding();
    nativeStop.mockImplementation(async (command: string, args: string[], options: unknown) => args[0] === 'rd.remote.inspect_installation'
      ? { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: args[0], data: { context_id: args.at(-1), device_serial: 'PHONE', package_name: 'helper', apk_sha256: 'a'.repeat(64), installation_state: 'clear', observation: 'verified', sessions: [] } }) }
      : native(command, args, options));
    const runtime = new RdcSessionRuntime();
    const result = await runtime.inspectReplayDeviceInstallation(scope, remoteDevice, { binding, expectedBindingIdentity: remotePreparationBindingIdentity(binding) });
    expect(result.state).toBe('clear'); expect(getRdcContextLease('session')).toBeNull();
    expect(nativeStop.mock.calls.some(call => call[1][0] === 'rd.remote.connect')).toBe(false);
    expect(runtime.getContextId()).toMatch(/^rdc-/);
    await runtime.clearOpenedCaptureForSession(scope); expect(runtime.getContextId()).toBeNull();
  });
  it('rejects a stale repair installation identity before starting any daemon', async () => {
    const runtime = new RdcSessionRuntime();
    await expect(runtime.prepareReplayDevice(scope, remoteDevice, { binding: remoteBinding(), expectedBindingIdentity: 'changed' })).rejects.toThrow('CONFIRMATION_STALE');
    expect(nativeStop).not.toHaveBeenCalled();
  });
  it('owns a context and connection without inventing a capture lease, then reuses them for Open and same-device file replacement', async () => {
    remoteNative(); const runtime = new RdcSessionRuntime(); const binding = remoteBinding();
    await runtime.prepareReplayDevice(scope, remoteDevice, { binding });
    const contextId = runtime.getContextId(); expect(contextId).toMatch(/^rdc-/);
    expect(runtime.snapshotOpenedCaptureForSession(scope)).toBeNull();
    expect(runtime.snapshotContextForSession(scope)).toMatchObject({ contextId, captureDescriptors: [], runtimeContext: null, backend: 'remote' });
    expect(getRdcContextLease('session')).toBeNull();
    const opened = await runtime.openProjectInput({ ...request, replayDevice: remoteDevice }, { binding });
    expect(opened).toMatchObject({ contextId, runtimeContext: { remoteId: 'remote' } });
    expect(getRdcContextLease('session')?.contextId).toBe(contextId);
    await runtime.openProjectInput({ ...request, inputId: 'another', replayDevice: remoteDevice }, { binding });
    const operations = nativeStop.mock.calls.map(call => call[1][0]);
    expect(operations.filter(value => value === 'start')).toHaveLength(1);
    expect(operations.filter(value => value === 'rd.remote.connect')).toHaveLength(1);
    expect(operations).toContain('rd.capture.close_replay');
    await runtime.clearOpenedCaptureForSession(scope); expect(getRdcContextLease('session')).toBeNull();
  });
  it('revalidates an idempotent prepared selection with ping rather than starting again', async () => {
    remoteNative(); const runtime = new RdcSessionRuntime(); const binding = remoteBinding();
    await runtime.prepareReplayDevice(scope, remoteDevice, { binding });
    await runtime.prepareReplayDevice(scope, remoteDevice, { binding });
    expect(nativeStop.mock.calls.filter(call => call[1][0] === 'rd.remote.connect')).toHaveLength(1);
    expect(nativeStop.mock.calls.some(call => call[1][0] === 'rd.remote.ping')).toBe(true);
    await runtime.clearOpenedCaptureForSession(scope);
  });
  it('withdraws the closed replay lease if file release fails, retaining context ownership until cleanup', async () => {
    remoteNative(); const runtime = new RdcSessionRuntime(); const binding = remoteBinding();
    await runtime.prepareReplayDevice(scope, remoteDevice, { binding });
    await runtime.openProjectInput({ ...request, replayDevice: remoteDevice }, { binding });
    const contextId = runtime.getContextId(); const native = nativeStop.getMockImplementation()!;
    nativeStop.mockImplementation(async (command: string, args: string[], options: unknown) => args[0] === 'rd.capture.close_file'
      ? { exitCode: 1, stdout: '', stderr: 'file release uncertain' } : native(command, args, options));
    await expect(runtime.openProjectInput({ ...request, inputId: 'replacement', replayDevice: remoteDevice }, { binding })).rejects.toThrow('CLI_FAILED');
    expect(getRdcContextLease('session')).toBeNull(); expect(runtime.snapshotOpenedCaptureForSession(scope)).toBeNull();
    expect(runtime.snapshotContextForSession(scope)).toMatchObject({ contextId, runtimeContext: null, captureDescriptors: [] });
    await runtime.clearOpenedCaptureForSession(scope); expect(runtime.getContextId()).toBeNull();
  });
  it('does not implicitly install/connect on Open or accept an old loose remote schema', async () => {
    const runtime = new RdcSessionRuntime();
    await expect(runtime.openProjectInput({ ...request, replayDevice: remoteDevice })).rejects.toThrow('NOT_PREPARED');
    await expect(runtime.prepareReplayDevice(scope, remoteDevice, { binding: freezeRdcTurnBinding(remoteBinding().cli, []) })).rejects.toThrow('REMOTE_UPGRADE_REQUIRED');
    expect(nativeStop).not.toHaveBeenCalled();
  });
  it('keeps local selection available without a configured native CLI', async () => {
    const runtime = new RdcSessionRuntime();
    const originalLoader = vi.mocked(rdcCliInvokerService.loadCatalog).getMockImplementation()!;
    vi.mocked(rdcCliInvokerService.loadCatalog).mockRejectedValueOnce(new Error('No Tools'));
    await runtime.prepareReplayDevice(scope, request.replayDevice);
    expect(runtime.isPreparedFor(scope, 'local')).toBe(true); expect(nativeStop).not.toHaveBeenCalled();
    vi.mocked(rdcCliInvokerService.loadCatalog).mockReset(); vi.mocked(rdcCliInvokerService.loadCatalog).mockImplementation(originalLoader);
  });
});

it('rejects changed CLI identity before opening a file through an already prepared connection', async () => {
  remoteNative(); const runtime = new RdcSessionRuntime(); const binding = remoteBinding();
  await runtime.prepareReplayDevice(scope, remoteDevice, { binding }); nativeStop.mockClear();
  const changed = freezeRdcTurnBinding({ ...binding.cli, command: 'other-install' }, [...binding.definitions]);
  await expect(runtime.openProjectInput({ ...request, replayDevice: remoteDevice }, { binding: changed })).rejects.toThrow('CLI_BINDING_CHANGED');
  expect(nativeStop).not.toHaveBeenCalled(); expect(runtime.getContextId()).toMatch(/^rdc-/);
  await runtime.clearOpenedCaptureForSession(scope);
});
