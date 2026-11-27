import { ipcMain } from 'electron';
import { AppError } from '@shared/errors/appError';
import { traceProjectionRefreshService } from '../agent-runtime/orchestration/TraceProjectionRefreshService';
import { replayDeviceService } from '../rdc/captures/ReplayDeviceService';
import { rdcSessionService } from '../rdc/RdcSessionService';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { projectWorkspaceStore, sessionRecordStore } from '../sessions/store/sessionStores';
import { replayDeviceIssue } from '../rdc/captures/ReplayDeviceIssue';
import { captureRecoveryStatus, recoverSessionCapture } from '../rdc/RdcCaptureRecovery';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { registerCaptureReplayReadHandlers } from './captureReplayReadHandlers';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import {
  CaptureOpenProjectInputArgsSchema,
  CaptureSelectArgsSchema,
  CaptureReplayApplyArgsSchema,
  CaptureReplayBindingArgsSchema,
  SessionScopeArgsSchema,
  DevicePreparationArgsSchema,
} from './validation/captureDeviceSchemas';
import type { WorkbenchIpcContext } from './workbenchContext';
import type { OpenProjectInputRequest, SessionScope, SessionScopedPayload } from '@shared/types/session';
import type { IpcChannelTable } from './invokeRegistry';

const envelope = <T>(scope: SessionScope, payload: T): SessionScopedPayload<T> => ({
  projectId: scope.projectId,
  sessionId: scope.sessionId,
  payload,
});

/** Scope authorization and the renderer broadcasts that capture channels send after a change. */
interface CaptureChannelContext {
  context: WorkbenchIpcContext;
  authorizeReplayScope: (scope: SessionScope) => void;
  broadcastContext: (
    scope: SessionScope,
    payload: ReturnType<typeof rdcSessionService.snapshotContextForSession>,
  ) => void;
  broadcastOpenedCapture: (
    scope: SessionScope,
    payload: ReturnType<typeof rdcSessionService.snapshotOpenedCaptureForSession>,
  ) => void;
}

export function registerCaptureDeviceHandlers(context: WorkbenchIpcContext): void {
  registerCaptureReplayReadHandlers();
  const authorizeReplayScope = (scope: SessionScope) => {
    if (sessionRecordStore.readSession(scope.sessionId)?.projectId !== scope.projectId)
      throw new AppError('REPLAY_SCOPE_DENIED');
  };
  const lastReplayHint = new Map<string, { phase: string; contextId: string | null; imageEventId: number | null }>();
  rdcSessionService.subscribe((state) => {
    context.broadcastToRenderer('capture:replayChanged', state);
    const previous = lastReplayHint.get(state.sessionId);
    lastReplayHint.set(state.sessionId, {
      phase: state.phase,
      contextId: state.contextId,
      imageEventId: state.imageEventId,
    });
    const terminal = state.phase === 'ready' || state.phase === 'error' || state.phase === 'closed';
    const identityChanged =
      !previous || previous.contextId !== state.contextId || previous.imageEventId !== state.imageEventId;
    if ((terminal && previous?.phase !== state.phase) || (identityChanged && previous)) {
      traceProjectionRefreshService.schedule(state.sessionId);
    }
  });
  const broadcastContext = (
    scope: SessionScope,
    payload: ReturnType<typeof rdcSessionService.snapshotContextForSession>,
  ) => {
    context.broadcastToRenderer('context:changed', envelope(scope, payload));
    traceProjectionRefreshService.schedule(scope.sessionId);
  };
  const broadcastOpenedCapture = (
    scope: SessionScope,
    payload: ReturnType<typeof rdcSessionService.snapshotOpenedCaptureForSession>,
  ) => {
    context.broadcastToRenderer('capture:openedStateChanged', envelope(scope, payload));
  };
  const channelContext: CaptureChannelContext = {
    context,
    authorizeReplayScope,
    broadcastContext,
    broadcastOpenedCapture,
  };
  const channels: IpcChannelTable = {
    ...replayChannels(channelContext),
    ...captureRecoveryChannels(channelContext),
    ...captureContextChannels(channelContext),
    ...openProjectInputChannel(channelContext),
    ...openedCaptureChannels(channelContext),
    ...deviceChannels(channelContext),
  };
  for (const [channel, handler] of Object.entries(channels)) ipcMain.handle(channel, handler);
}

/** Replay state, frame refresh and event navigation of an authorized session scope. */
function replayChannels({ authorizeReplayScope }: CaptureChannelContext): IpcChannelTable {
  return {
    'capture:getReplayState': (_event, ...rawArgs: unknown[]) => {
      const [scope] = parseIpcArgs(SessionScopeArgsSchema, rawArgs, {
        label: 'capture:getReplayState',
        maxBytes: 1024,
      });
      authorizeReplayScope(scope);
      return rdcSessionService.snapshotReplayForSession(scope);
    },
    'capture:refreshFrame': (_event, ...rawArgs: unknown[]) => {
      const [scope] = parseIpcArgs(CaptureReplayBindingArgsSchema, rawArgs, {
        label: 'capture:refreshFrame',
        maxBytes: 1024,
      });
      authorizeReplayScope(scope);
      return rdcSessionService.refreshFrameForSession(scope);
    },
    'capture:applyReplayEvent': (_event, ...rawArgs: unknown[]) => {
      const [request] = parseIpcArgs(CaptureReplayApplyArgsSchema, rawArgs, {
        label: 'capture:applyReplayEvent',
        maxBytes: 4096,
      });
      authorizeReplayScope(request);
      return rdcSessionService.applyEventForSession(request);
    },
  };
}

/** Capture recovery status and the person's recovery of the session's replay. */
function captureRecoveryChannels({
  context,
  authorizeReplayScope,
  broadcastContext,
  broadcastOpenedCapture,
}: CaptureChannelContext): IpcChannelTable {
  return {
    'capture:getRecovery': (_event, ...rawArgs: unknown[]) => {
      const [scope] = parseIpcArgs(SessionScopeArgsSchema, rawArgs, { label: 'capture:getRecovery', maxBytes: 1024 });
      authorizeReplayScope(scope);
      return captureRecoveryStatus(scope);
    },
    'capture:recover': async (_event, ...rawArgs: unknown[]) => {
      const [scope] = parseIpcArgs(CaptureReplayBindingArgsSchema, rawArgs, {
        label: 'capture:recover',
        maxBytes: 1024,
      });
      authorizeReplayScope(scope);
      try {
        // A person's click recovers the session's replay; it never starts an Agent.
        const state = await recoverSessionCapture(scope, { kind: 'user', bindingGeneration: scope.bindingGeneration });
        broadcastOpenedCapture(scope, rdcSessionService.snapshotOpenedCaptureForSession(scope));
        broadcastContext(scope, rdcSessionService.snapshotContextForSession(scope));
        context.broadcastToRenderer('capture:replayChanged', state);
        return state;
      } catch (error) {
        broadcastOpenedCapture(scope, rdcSessionService.snapshotOpenedCaptureForSession(scope));
        broadcastContext(scope, rdcSessionService.snapshotContextForSession(scope));
        throw error;
      }
    },
  };
}

/** The RDC context of a session scope, its captures, and switching the active capture. */
function captureContextChannels({ context, broadcastContext }: CaptureChannelContext): IpcChannelTable {
  return {
    'context:get': async (_event, ...rawArgs: unknown[]) => {
      const [scope] = parseIpcArgs(SessionScopeArgsSchema, rawArgs, { label: 'context:get', maxBytes: 1024 });
      return rdcSessionService.snapshotContextForSession(scope);
    },
    'capture:list': async (_event, ...rawArgs: unknown[]) => {
      const [scope] = parseIpcArgs(SessionScopeArgsSchema, rawArgs, { label: 'capture:list', maxBytes: 1024 });
      return { captures: rdcSessionService.snapshotContextForSession(scope)?.captureDescriptors ?? [] };
    },
    'capture:select': async (_event, ...rawArgs: unknown[]) => {
      const [request] = parseIpcArgs(CaptureSelectArgsSchema, rawArgs, {
        label: 'capture:select',
        maxBytes: 4 * 1024,
      });
      const scope: SessionScope = { projectId: request.projectId, sessionId: request.sessionId };
      const snapshot = rdcSessionService.snapshotContextForSession(scope);
      if (!snapshot?.captureDescriptors.some((capture) => capture.id === request.captureId)) {
        throw new AppError('CAPTURE_SELECTION_INVALID', `${request.captureId} is not owned by this session.`);
      }
      await rdcSessionService.switchActiveCapture(request, request.captureId);
      context.broadcastToRenderer(
        'capture:statusChanged',
        envelope(scope, { captureId: request.captureId, status: 'selected' }),
      );
      broadcastContext(scope, rdcSessionService.snapshotContextForSession(scope));
    },
  };
}

/** Opening a project input on a replay device, logged and broadcast whether it succeeds or fails. */
function openProjectInputChannel({
  authorizeReplayScope,
  broadcastContext,
  broadcastOpenedCapture,
}: CaptureChannelContext): IpcChannelTable {
  return {
    'capture:openProjectInput': async (_event, ...rawArgs: unknown[]) => {
      let request:
        | (Omit<OpenProjectInputRequest, 'replayDevice'> & { replayDeviceId: string; bindingGeneration: number })
        | undefined;
      try {
        [request] = parseIpcArgs(CaptureOpenProjectInputArgsSchema, rawArgs, {
          label: 'capture:openProjectInput',
          maxBytes: 16 * 1024,
        }) as [Omit<OpenProjectInputRequest, 'replayDevice'> & { replayDeviceId: string; bindingGeneration: number }];
        authorizeReplayScope(request);
        const input = (await projectWorkspaceStore.listProjectInputs(request.projectId)).find(
          (entry) => entry.inputId === request!.inputId && entry.filePath === request!.filePath,
        );
        if (!input) throw new AppError('PROJECT_INPUT_NOT_FOUND', request.inputId);

        const replayDevice = replayDeviceService.getDeviceById(request.replayDeviceId);
        if (!replayDevice) throw new AppError('RDC_DEVICE_NOT_FOUND', request.replayDeviceId);

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
        const openedCapture = await rdcSessionService.openProjectInput(
          {
            projectId: request.projectId,
            sessionId: request.sessionId,
            inputId: input.inputId,
            filePath: input.filePath,
            replayDevice,
          },
          { expectedGeneration: request.bindingGeneration },
        );
        const scope: SessionScope = { projectId: request.projectId, sessionId: request.sessionId };
        const contextSnapshot = rdcSessionService.snapshotContextForSession(scope);
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
          raw: {
            inputId: openedCapture.inputId,
            contextId: openedCapture.contextId,
            captureHash: rdcSessionService.snapshotReplayForSession(scope).captureHash,
          },
        });
        return { openedCapture, contextSnapshot };
      } catch (error) {
        const scope = request ? { projectId: request.projectId, sessionId: request.sessionId } : null;
        if (scope) {
          broadcastOpenedCapture(scope, rdcSessionService.snapshotOpenedCaptureForSession(scope));
          broadcastContext(scope, rdcSessionService.snapshotContextForSession(scope));
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
        throw error;
      }
    },
  };
}

/** The opened-capture state of a session scope and clearing it. */
function openedCaptureChannels({ broadcastContext, broadcastOpenedCapture }: CaptureChannelContext): IpcChannelTable {
  return {
    'capture:getOpenedState': async (_event, ...rawArgs: unknown[]) => {
      const [scope] = parseIpcArgs(SessionScopeArgsSchema, rawArgs, {
        label: 'capture:getOpenedState',
        maxBytes: 1024,
      });
      return rdcSessionService.snapshotOpenedCaptureForSession(scope);
    },
    'capture:clearOpenedState': async (_event, ...rawArgs: unknown[]) => {
      const [scope] = parseIpcArgs(CaptureReplayBindingArgsSchema, rawArgs, {
        label: 'capture:clearOpenedState',
        maxBytes: 1024,
      });
      const cleared = await rdcSessionService.clearOpenedCaptureForSession(scope, {
        expectedGeneration: scope.bindingGeneration,
      });
      if (!cleared) throw new AppError('RDC_NOT_OPEN', 'no RDC context is owned by this session.');
      broadcastOpenedCapture(scope, null);
      broadcastContext(scope, null);
      runtimeLogService.log({
        scope: 'session',
        namespace: 'capture',
        severity: 'info',
        title: 'Opened capture cleared',
        summary: 'The session-owned RDC context was cleared.',
        sessionId: scope.sessionId,
        projectId: scope.projectId,
      });
    },
  };
}

/** Replay devices: listing, preparation and the device watch. */
function deviceChannels({ authorizeReplayScope }: CaptureChannelContext): IpcChannelTable {
  return {
    'device:list': async (_event, ...rawArgs: unknown[]) => {
      parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'device:list', maxBytes: 1024 });
      return replayDeviceService.getSnapshot();
    },
    'device:prepare': async (_event, ...rawArgs: unknown[]) => {
      const [request] = parseIpcArgs(DevicePreparationArgsSchema, rawArgs, { label: 'device:prepare', maxBytes: 4096 });
      authorizeReplayScope(request);
      try {
        return await rdcSessionService.prepareDevice(request);
      } catch (error) {
        return {
          success: false,
          state: rdcSessionService.snapshotReplayForSession(request),
          error: replayDeviceIssue(error),
        };
      }
    },
    'device:cancelPreparation': async (_event, ...rawArgs: unknown[]) => {
      const [request] = parseIpcArgs(CaptureReplayBindingArgsSchema, rawArgs, {
        label: 'device:cancelPreparation',
        maxBytes: 1024,
      });
      authorizeReplayScope(request);
      try {
        return await rdcSessionService.cancelDevicePreparation(request);
      } catch (error) {
        return {
          success: false,
          state: rdcSessionService.snapshotReplayForSession(request),
          error: replayDeviceIssue(error),
        };
      }
    },
    'device:refresh': async (_event, ...rawArgs: unknown[]) => {
      parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'device:refresh', maxBytes: 1024 });
      await replayDeviceService.refreshDevices();
      return replayDeviceService.getSnapshot();
    },
    'device:watch:start': async (_event, ...rawArgs: unknown[]) => {
      parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'device:watch:start', maxBytes: 1024 });
      replayDeviceService.startWatch();
    },
    'device:watch:renew': async (_event, ...rawArgs: unknown[]) => {
      parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'device:watch:renew', maxBytes: 1024 });
      replayDeviceService.renewWatch();
    },
    'device:watch:stop': async (_event, ...rawArgs: unknown[]) => {
      parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'device:watch:stop', maxBytes: 1024 });
      replayDeviceService.stopWatch();
    },
  };
}
