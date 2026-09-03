import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayDeviceEntry } from '@shared/types/device';
import type { OpenProjectInputRequest, SessionScope } from '@shared/types/session';
import { clearRdxContextLeases } from './RdxRuntimeContextRegistry';

const runAction = vi.fn();

vi.mock('electron', () => ({
  nativeImage: {
    createFromPath: () => ({
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 }),
      toDataURL: () => '',
    }),
  },
  BrowserWindow: class {},
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

vi.mock('../captures/ReplayDeviceService', () => ({
  replayDeviceService: {
    peekPreparedRemote: () => null,
    getDeviceById: () => undefined,
    activateDevice: vi.fn(),
  },
}));

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
        data: { contextId: 'ctx-owned', captureId: 'capture-a' },
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
});
