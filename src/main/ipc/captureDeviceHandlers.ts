import { ipcMain } from 'electron';
import type { OpenProjectInputRequest } from '@shared/types/session';
import { replayDeviceService } from '../captures/ReplayDeviceService';
import { rdxSessionService } from '../index';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { storageAdapter } from '../sessions/StorageAdapter';
import type { WorkbenchIpcContext } from './workbenchContext';

export function registerCaptureDeviceHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;

  ipcMain.handle('context:get', async () => {
    return rdxSessionService.snapshotContext();
  });

  ipcMain.handle('context:openHumanPreview', async (_event, request?: { sessionId?: string }) => {
    try {
      const contextSnapshot = await rdxSessionService.openHumanPreviewWindow(request);
      context.broadcastToRenderer('context:changed', contextSnapshot);
      const preview = contextSnapshot.humanPreview;
      return {
        success: preview?.status === 'open' || preview?.status === 'opening',
        contextSnapshot,
        error: preview?.lastError,
      };
    } catch (error) {
      const contextSnapshot = rdxSessionService.snapshotContext();
      return {
        success: false,
        contextSnapshot,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('context:closeHumanPreview', async () => {
    try {
      const contextSnapshot = await rdxSessionService.closeHumanPreviewWindow();
      context.broadcastToRenderer('context:changed', contextSnapshot);
      return {
        success: contextSnapshot.humanPreview?.status === 'closed',
        contextSnapshot,
        error: contextSnapshot.humanPreview?.lastError,
      };
    } catch (error) {
      const contextSnapshot = rdxSessionService.snapshotContext();
      return {
        success: false,
        contextSnapshot,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('capture:list', async () => {
    return { captures: rdxSessionService.getCaptureDescriptors() };
  });

  ipcMain.handle(
    'capture:openProjectInput',
    async (_event, request: Omit<OpenProjectInputRequest, 'replayDevice'> & { replayDeviceId: string }) => {
      try {
        runtimeLogService.log({
          scope: state.currentSessionId ? 'session' : 'app',
          namespace: 'capture',
          severity: 'info',
          title: 'Open project input',
          summary: `开始打开 ${request.inputId}。`,
          detail: request.filePath,
          sessionId: state.currentSessionId,
          projectId: request.projectId,
          runId: state.currentRunId,
          raw: {
            inputId: request.inputId,
            replayDeviceId: request.replayDeviceId,
            filePath: request.filePath,
          },
        });
        const input = storageAdapter.listProjectInputs(request.projectId)
          .find((entry) => entry.inputId === request.inputId && entry.filePath === request.filePath);
        if (!input) {
          return { success: false, error: `Project input not found: ${request.inputId}` };
        }

        const replayDevice = replayDeviceService.getDeviceById(request.replayDeviceId);
        if (!replayDevice) {
          return { success: false, error: `Replay device not found: ${request.replayDeviceId}` };
        }

        const openedCapture = await rdxSessionService.openProjectInput({
          projectId: request.projectId,
          inputId: input.inputId,
          filePath: input.filePath,
          replayDevice,
        });
        const contextSnapshot = rdxSessionService.snapshotContext();
        context.broadcastToRenderer('capture:openedStateChanged', openedCapture);
        context.broadcastToRenderer('context:changed', contextSnapshot);
        runtimeLogService.log({
          scope: state.currentSessionId ? 'session' : 'app',
          namespace: 'capture',
          severity: 'success',
          title: 'Project input opened',
          summary: `${input.fileName} 已打开。`,
          detail: openedCapture.preview?.source === 'framebuffer_screenshot'
            ? '预览来源：framebuffer'
            : openedCapture.preview?.source === 'capture_thumbnail'
              ? '预览来源：thumbnail'
              : openedCapture.previewError?.code
                ? `当前无可用预览：${openedCapture.previewError.code}`
                : '当前无可用预览',
          sessionId: state.currentSessionId,
          projectId: request.projectId,
          runId: state.currentRunId,
          raw: {
            openedCapture,
            contextSnapshot,
          },
        });
        return { success: true, openedCapture, contextSnapshot };
      } catch (err) {
        runtimeLogService.log({
          scope: state.currentSessionId ? 'session' : 'app',
          namespace: 'capture',
          severity: 'error',
          title: 'Project input open failed',
          summary: err instanceof Error ? err.message : String(err),
          sessionId: state.currentSessionId,
          projectId: request.projectId,
          runId: state.currentRunId,
          raw: {
            inputId: request.inputId,
            replayDeviceId: request.replayDeviceId,
            filePath: request.filePath,
          },
        });
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle('capture:getOpenedState', async () => {
    return rdxSessionService.snapshotOpenedCapture();
  });

  ipcMain.handle('capture:clearOpenedState', async () => {
    await rdxSessionService.closeOrReplaceOpenedCapture();
    context.broadcastToRenderer('capture:openedStateChanged', null);
    context.broadcastToRenderer('context:changed', rdxSessionService.snapshotContext());
    runtimeLogService.log({
      scope: state.currentSessionId ? 'session' : 'app',
      namespace: 'capture',
      severity: 'info',
      title: 'Opened capture cleared',
      summary: '当前打开的 capture 已清理。',
      sessionId: state.currentSessionId,
      projectId: state.currentProjectId,
      runId: state.currentRunId,
    });
    return { success: true };
  });

  ipcMain.handle('capture:select', async (_event, captureId: string) => {
    try {
      await rdxSessionService.switchActiveCapture(captureId);
      context.broadcastToRenderer('capture:statusChanged', { captureId, status: 'selected' });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('device:list', async () => {
    return replayDeviceService.listDevices();
  });

  ipcMain.handle('device:refresh', async () => {
    return replayDeviceService.refreshDevices();
  });

  ipcMain.handle('device:activate', async (_event, deviceId: string) => {
    return replayDeviceService.activateDevice(deviceId);
  });
}
