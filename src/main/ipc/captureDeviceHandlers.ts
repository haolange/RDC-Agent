import { ipcMain } from 'electron';
import { traceProjectionRefreshService } from '../agent-trace/TraceProjectionRefreshService';
import type { OpenProjectInputRequest, SessionScope, SessionScopedPayload } from '@shared/types/session';
import { replayDeviceService } from '../captures/ReplayDeviceService';
import { rdxSessionService } from '../sessions';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { storageAdapter } from '../sessions/StorageAdapter';
import type { WorkbenchIpcContext } from './workbenchContext';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import {
  CaptureOpenProjectInputArgsSchema,
  CaptureSelectArgsSchema,
  ContextOpenHumanPreviewArgsSchema,
  DeviceActivateArgsSchema,
  SessionScopeArgsSchema,
} from './validation/captureDeviceSchemas';

const envelope = <T>(scope: SessionScope, payload: T): SessionScopedPayload<T> => ({
  projectId: scope.projectId,
  sessionId: scope.sessionId,
  payload,
});

export function registerCaptureDeviceHandlers(context: WorkbenchIpcContext): void {
  const broadcastContext = (scope: SessionScope, payload: ReturnType<typeof rdxSessionService.snapshotContextForSession>) => {
    context.broadcastToRenderer('context:changed', envelope(scope, payload));
    traceProjectionRefreshService.schedule(scope.sessionId);
  };
  const broadcastOpenedCapture = (scope: SessionScope, payload: ReturnType<typeof rdxSessionService.snapshotOpenedCaptureForSession>) => {
    context.broadcastToRenderer('capture:openedStateChanged', envelope(scope, payload));
  };

  ipcMain.handle('context:get', async (_event, ...rawArgs: unknown[]) => {
    const [scope] = parseIpcArgs(SessionScopeArgsSchema, rawArgs, { label: 'context:get', maxBytes: 1024 });
    return rdxSessionService.snapshotContextForSession(scope);
  });

  ipcMain.handle('context:openHumanPreview', async (_event, ...rawArgs: unknown[]) => {
    const [scope] = parseIpcArgs(ContextOpenHumanPreviewArgsSchema, rawArgs, {
      label: 'context:openHumanPreview',
      maxBytes: 4 * 1024,
    });
    try {
      const contextSnapshot = await rdxSessionService.openHumanPreviewWindow(scope);
      broadcastContext(scope, contextSnapshot);
      const preview = contextSnapshot?.humanPreview;
      return {
        success: preview?.status === 'open' || preview?.status === 'opening',
        contextSnapshot,
        error: preview?.lastError,
      };
    } catch (error) {
      const contextSnapshot = rdxSessionService.snapshotContextForSession(scope);
      return {
        success: false,
        contextSnapshot,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('context:closeHumanPreview', async (_event, ...rawArgs: unknown[]) => {
    const [scope] = parseIpcArgs(SessionScopeArgsSchema, rawArgs, {
      label: 'context:closeHumanPreview',
      maxBytes: 1024,
    });
    try {
      const contextSnapshot = await rdxSessionService.closeHumanPreviewWindow(scope);
      broadcastContext(scope, contextSnapshot);
      return {
        success: contextSnapshot?.humanPreview?.status === 'closed',
        contextSnapshot,
        error: contextSnapshot?.humanPreview?.lastError,
      };
    } catch (error) {
      const contextSnapshot = rdxSessionService.snapshotContextForSession(scope);
      return {
        success: false,
        contextSnapshot,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('capture:list', async (_event, ...rawArgs: unknown[]) => {
    const [scope] = parseIpcArgs(SessionScopeArgsSchema, rawArgs, { label: 'capture:list', maxBytes: 1024 });
    return { captures: rdxSessionService.snapshotContextForSession(scope)?.captureDescriptors ?? [] };
  });

  ipcMain.handle('capture:openProjectInput', async (_event, ...rawArgs: unknown[]) => {
    let request: Omit<OpenProjectInputRequest, 'replayDevice'> & { replayDeviceId: string } | undefined;
    try {
      [request] = parseIpcArgs(CaptureOpenProjectInputArgsSchema, rawArgs, {
        label: 'capture:openProjectInput',
        maxBytes: 16 * 1024,
      }) as [Omit<OpenProjectInputRequest, 'replayDevice'> & { replayDeviceId: string }];
      const session = storageAdapter.readSession(request.sessionId);
      if (!session || session.projectId !== request.projectId) {
        return { success: false, error: 'Session does not belong to the requested project.' };
      }
      const input = storageAdapter.listProjectInputs(request.projectId)
        .find((entry) => entry.inputId === request!.inputId && entry.filePath === request!.filePath);
      if (!input) return { success: false, error: `Project input not found: ${request.inputId}` };

      const replayDevice = replayDeviceService.getDeviceById(request.replayDeviceId);
      if (!replayDevice) return { success: false, error: `Replay device not found: ${request.replayDeviceId}` };

      runtimeLogService.log({
        scope: 'session',
        namespace: 'capture',
        severity: 'info',
        title: 'Open project input',
        summary: `Opening ${input.fileName}`,
        detail: input.filePath,
        sessionId: request.sessionId,
        projectId: request.projectId,
        raw: { inputId: request.inputId, replayDeviceId: request.replayDeviceId },
      });
      const openedCapture = await rdxSessionService.openProjectInput({
        projectId: request.projectId,
        sessionId: request.sessionId,
        inputId: input.inputId,
        filePath: input.filePath,
        replayDevice,
      });
      const scope: SessionScope = { projectId: request.projectId, sessionId: request.sessionId };
      const contextSnapshot = rdxSessionService.snapshotContextForSession(scope);
      broadcastOpenedCapture(scope, openedCapture);
      broadcastContext(scope, contextSnapshot);
      runtimeLogService.log({
        scope: 'session',
        namespace: 'capture',
        severity: 'success',
        title: 'Project input opened',
        summary: `${input.fileName} opened`,
        detail: openedCapture.preview?.source ?? openedCapture.previewError?.code ?? 'Preview unavailable',
        sessionId: request.sessionId,
        projectId: request.projectId,
        raw: { openedCapture, contextSnapshot },
      });
      return { success: true, openedCapture, contextSnapshot };
    } catch (error) {
      const scope = request ? { projectId: request.projectId, sessionId: request.sessionId } : null;
      if (scope) {
        broadcastOpenedCapture(scope, rdxSessionService.snapshotOpenedCaptureForSession(scope));
        broadcastContext(scope, rdxSessionService.snapshotContextForSession(scope));
      }
      runtimeLogService.log({
        scope: 'session',
        namespace: 'capture',
        severity: 'error',
        title: 'Project input open failed',
        summary: error instanceof Error ? error.message : String(error),
        sessionId: request?.sessionId,
        projectId: request?.projectId,
        raw: request ? { inputId: request.inputId, replayDeviceId: request.replayDeviceId } : undefined,
      });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('capture:getOpenedState', async (_event, ...rawArgs: unknown[]) => {
    const [scope] = parseIpcArgs(SessionScopeArgsSchema, rawArgs, { label: 'capture:getOpenedState', maxBytes: 1024 });
    return rdxSessionService.snapshotOpenedCaptureForSession(scope);
  });

  ipcMain.handle('capture:clearOpenedState', async (_event, ...rawArgs: unknown[]) => {
    const [scope] = parseIpcArgs(SessionScopeArgsSchema, rawArgs, { label: 'capture:clearOpenedState', maxBytes: 1024 });
    const cleared = await rdxSessionService.clearOpenedCaptureForSession(scope);
    if (!cleared) return { success: false, error: 'No RDX context is owned by this session.' };
    broadcastOpenedCapture(scope, null);
    broadcastContext(scope, null);
    runtimeLogService.log({
      scope: 'session',
      namespace: 'capture',
      severity: 'info',
      title: 'Opened capture cleared',
      summary: 'The session-owned RDX context was cleared.',
      sessionId: scope.sessionId,
      projectId: scope.projectId,
    });
    return { success: true };
  });

  ipcMain.handle('capture:select', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [request] = parseIpcArgs(CaptureSelectArgsSchema, rawArgs, { label: 'capture:select', maxBytes: 4 * 1024 });
      const scope: SessionScope = { projectId: request.projectId, sessionId: request.sessionId };
      const snapshot = rdxSessionService.snapshotContextForSession(scope);
      if (!snapshot?.captureDescriptors.some((capture) => capture.id === request.captureId)) {
        return { success: false, error: 'Capture is not owned by this session.' };
      }
      await rdxSessionService.switchActiveCapture(request.captureId);
      context.broadcastToRenderer('capture:statusChanged', envelope(scope, { captureId: request.captureId, status: 'selected' }));
      broadcastContext(scope, rdxSessionService.snapshotContextForSession(scope));
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('device:list', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'device:list', maxBytes: 1024 });
    return replayDeviceService.listDevices();
  });

  ipcMain.handle('device:refresh', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'device:refresh', maxBytes: 1024 });
    return replayDeviceService.refreshDevices();
  });

  ipcMain.handle('device:activate', async (_event, ...rawArgs: unknown[]) => {
    const [deviceId] = parseIpcArgs(DeviceActivateArgsSchema, rawArgs, { label: 'device:activate', maxBytes: 4 * 1024 });
    return replayDeviceService.activateDevice(deviceId);
  });
}