import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayDeviceEntry } from '@shared/types/device';
import type { OpenProjectInputRequest, SessionScope } from '@shared/types/session';
import { clearRdxContextLeases, getRdxContextLease } from './RdxRuntimeContextRegistry';

const runAction = vi.fn();
const nativeCli = vi.hoisted(() => vi.fn());
vi.mock('../tools/RdxCliInvokerService', () => ({ rdxCliInvokerService: { executeCLI: nativeCli } }));
const remote = vi.hoisted(() => ({ peek: vi.fn(), consume: vi.fn(), get: vi.fn(), activate: vi.fn() }));

vi.mock('electron', () => ({
  nativeImage: {
    createFromPath: () => ({
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 }),
      toDataURL: () => '',
    }),
  },
  BrowserWindow: class { static getAllWindows() { return []; } },
  app: {
    getPath: () => process.cwd(),
    getAppPath: () => process.cwd(),
  },
}));

vi.mock('../tools/RdxShellActionService', () => ({
  rdxShellActionService: {
    runAction: (...args: unknown[]) => runAction(...args),
  },
  formatRdxActionDiagnostic: (diagnostic: { message: string }) => diagnostic.message,
  isLocalReplayUnsupportedDiagnostic: () => false,
}));

vi.mock('../runtime/RuntimeLogService', () => ({
  runtimeLogService: { log: vi.fn() },
}));

vi.mock('../runtime/ProcessSupervisor', () => ({
  processSupervisor: { list: () => [] },
}));

vi.mock('../tools/ShellInvocationService', () => ({
  shellInvocationService: { terminateAll: vi.fn() },
}));

vi.mock('../captures/ReplayDeviceService', () => ({
  replayDeviceService: {
    peekPreparedRemote: remote.peek,
    consumePreparedRemote: remote.consume,
    getDeviceById: remote.get,
    activateDevice: remote.activate,
  },
}));

import { runtimeLogService } from '../runtime/RuntimeLogService';
import { RdxSessionService } from './RdxSessionService';

const ownerScope: SessionScope = { projectId: 'project-a', sessionId: 'session-a' };
const wrongSession: SessionScope = { projectId: 'project-a', sessionId: 'session-b' };
const wrongProject: SessionScope = { projectId: 'project-b', sessionId: 'session-a' };

const localDevice: ReplayDeviceEntry = {
  id: 'local',
  label: 'Local',
  type: 'local',
  status: 'online',
  transport: 'local',
};

const openRequest: OpenProjectInputRequest = {
  projectId: ownerScope.projectId,
  sessionId: ownerScope.sessionId,
  inputId: 'input-a',
  filePath: 'C:/captures/sample.rdc',
  replayDevice: localDevice,
};

async function openOwnedCapture(service: RdxSessionService): Promise<void> {
  runAction.mockImplementation(async (actionId: string) => {
    if (actionId === 'openCapture') {
      return {
        ok: true,
        actionId,
        data: { context_id: 'ctx-owned', session_id: 'native-session', capture_file_id: 'capture-a' },
        stdout: '',
        stderr: '',
        exitCode: 0,
      };
    }
    return { ok: true, actionId, data: {}, stdout: '', stderr: '', exitCode: 0 };
  });
  await service.openProjectInput(openRequest);
  runAction.mockClear();
}

describe('RdxSessionService capture ownership fail-closed', () => {
  beforeEach(() => {
    runAction.mockReset();
    for (const fn of Object.values(remote)) fn.mockReset();
    clearRdxContextLeases();
  });

  afterEach(() => {
    clearRdxContextLeases();
  });

  it('returns null or false when no capture is open', async () => {
    const service = new RdxSessionService();
    expect(service.snapshotOpenedCaptureForSession(ownerScope)).toBeNull();
    expect(service.snapshotContextForSession(ownerScope)).toBeNull();
    expect(await service.clearOpenedCaptureForSession(ownerScope)).toBe(false);
    expect(await service.openHumanPreviewWindow(ownerScope)).toBeNull();
    expect(await service.closeHumanPreviewWindow(ownerScope)).toBeNull();
    expect(runAction).not.toHaveBeenCalled();
  });

  it('does not project or mutate capture state for the wrong owner', async () => {
    const service = new RdxSessionService();
    await openOwnedCapture(service);

    expect(service.snapshotOpenedCaptureForSession(ownerScope)).toMatchObject({
      projectId: ownerScope.projectId,
      ownerSessionId: ownerScope.sessionId,
      inputId: 'input-a',
    });
    expect(service.snapshotOpenedCaptureForSession(wrongSession)).toBeNull();
    expect(service.snapshotOpenedCaptureForSession(wrongProject)).toBeNull();
    expect(service.snapshotContextForSession(wrongSession)).toBeNull();
    expect(service.snapshotContextForSession(wrongProject)).toBeNull();
    expect(await service.clearOpenedCaptureForSession(wrongSession)).toBe(false);
    expect(await service.clearOpenedCaptureForSession(wrongProject)).toBe(false);
    expect(await service.openHumanPreviewWindow(wrongSession)).toBeNull();
    expect(await service.closeHumanPreviewWindow(wrongProject)).toBeNull();
    expect(service.snapshotOpenedCaptureForSession(ownerScope)?.inputId).toBe('input-a');
    expect(runAction).not.toHaveBeenCalled();
  });

  it('retains capture ownership when graceful close fails without writing a leak file', async () => {
    vi.useFakeTimers();
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync');
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync');
    try {
      const service = new RdxSessionService();
      await openOwnedCapture(service);
      runAction.mockImplementation(async (actionId: string) => ({
        ok: actionId !== 'closeRuntime',
        actionId,
        error: actionId === 'closeRuntime' ? 'close failed' : undefined,
        data: {},
        stdout: '',
        stderr: actionId === 'closeRuntime' ? 'boom' : '',
        exitCode: actionId === 'closeRuntime' ? 1 : 0,
      }));

      await expect(service.clearOpenedCaptureForSession(ownerScope)).rejects.toThrow('RDX_CLOSE_FAILED');
      expect(service.snapshotOpenedCaptureForSession(ownerScope)).not.toBeNull();

      const leakMarkerName = ['rdx-runtime-leak', '.json'].join('');
      const leakWrites = [...writeSpy.mock.calls, ...mkdirSpy.mock.calls, ...unlinkSpy.mock.calls]
        .map((args) => String(args[0] ?? ''))
        .filter((filePath) => filePath.includes(leakMarkerName));
      expect(leakWrites).toEqual([]);
      expect(runtimeLogService.log).toHaveBeenCalledWith(expect.objectContaining({
        title: 'RDX runtime close warning',
        summary: 'close failed',
      }));
    } finally {
      writeSpy.mockRestore();
      mkdirSpy.mockRestore();
      unlinkSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});


describe('native replay lifecycle validation', () => {
  beforeEach(() => { runAction.mockReset(); for (const fn of Object.values(remote)) fn.mockReset(); clearRdxContextLeases(); });
  afterEach(() => { clearRdxContextLeases(); });
  it.each([
    { context_id: 'default', session_id: 'native' },
    { context_id: 'owned' },
  ])('does not register an invalid native open payload %j', async (data) => {
    runAction.mockImplementation(async (actionId: string) => ({ ok: true, actionId, data: actionId === 'openCapture' ? data : {}, stdout: '', stderr: '', exitCode: 0 }));
    const service = new RdxSessionService();
    await expect(service.openProjectInput(openRequest)).rejects.toThrow(/RDX action result/);
    expect(getRdxContextLease(ownerScope.sessionId)).toBeNull();
    expect(service.snapshotOpenedCaptureForSession(ownerScope)).toBeNull();
  });
  it.each([true, false])('consumes a remote handle once even when open success=%s', async (success) => {
    const device: ReplayDeviceEntry = { id: 'android-test', type: 'android', label: 'Test device', status: 'online', transport: 'adb_android', serial: 'synthetic-serial' };
    const prepared = { contextId: 'remote-owned', remoteId: 'remote-once', deviceId: device.id };
    let available = true;
    remote.get.mockReturnValue(device);
    remote.peek.mockImplementation(() => available ? prepared : null);
    remote.consume.mockImplementation(() => { available = false; return prepared; });
    remote.activate.mockResolvedValue({ ...device, status: 'error', lastError: 'Reconnect required' });
    runAction.mockImplementation(async (actionId: string) => ({ ok: actionId !== 'openRemoteCapture' || success, actionId,
      data: actionId === 'openRemoteCapture' ? { context_id: 'remote-owned', session_id: 'native-remote' } : {},
      error: success ? undefined : 'remote failure', stdout: '', stderr: '', exitCode: success ? 0 : 1 }));
    const service = new RdxSessionService();
    const opening = service.openProjectInput({ ...openRequest, replayDevice: device });
    if (success) await opening; else await expect(opening).rejects.toThrow(/remote failure/);
    expect(remote.consume).toHaveBeenCalledTimes(1);
    expect(remote.peek()).toBeNull();
    await expect(service.openProjectInput({ ...openRequest, replayDevice: device })).rejects.toThrow(/Reconnect required/);
    expect(remote.activate).toHaveBeenCalledTimes(1);
    expect(runAction.mock.calls.filter(call => call[0] === 'openRemoteCapture')).toHaveLength(1);
  });
});

describe('native preview confirmation', () => {
  beforeEach(() => { runAction.mockReset(); nativeCli.mockReset(); clearRdxContextLeases(); });
  afterEach(() => { clearRdxContextLeases(); });
  it.each([
    ['confirmed', 0, { context_id: 'ctx-owned', preview: { enabled: false } }, 'closed'],
    ['still enabled', 0, { context_id: 'ctx-owned', preview: { enabled: true } }, 'error'],
    ['wrong context', 0, { context_id: 'other', preview: { enabled: false } }, 'error'],
    ['failed process', 1, { context_id: 'ctx-owned', preview: { enabled: false } }, 'error'],
  ] as const)('requires native close confirmation: %s', async (_label, exitCode, data, status) => {
    const service = new RdxSessionService();
    await openOwnedCapture(service);
    nativeCli.mockResolvedValue({ exitCode, stdout: JSON.stringify({ ok: true, result_kind: 'preview', data }), stderr: '' });
    expect((await service.closeHumanPreviewWindow(ownerScope))?.humanPreview?.status).toBe(status);
    expect(nativeCli).toHaveBeenCalledWith('session', ['preview', 'off', '--daemon-context', 'ctx-owned'], expect.any(Object));
    expect(getRdxContextLease(ownerScope.sessionId)).not.toBeNull();
  });
  it('does not invent an open preview from an empty success payload', async () => {
    const service = new RdxSessionService();
    await openOwnedCapture(service);
    expect((await service.openHumanPreviewWindow(ownerScope))?.humanPreview?.status).toBe('error');
  });
});
