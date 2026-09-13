import { rdxSessionService } from '../sessions';
import { ipcMain } from 'electron';
import { z } from 'zod';
import { replayHistoryStore } from '../captures/replay/ReplayHistoryStore';
import { storageAdapter } from '../sessions/StorageAdapter';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { SessionScopeSchema, SessionScopeArgsSchema } from './validation/captureDeviceSchemas';
import type { SessionScope } from '@shared/types/session';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const history = SessionScopeSchema.extend({ captureHash: hash }).strict();
function authorize(scope: SessionScope) {
  const session = storageAdapter.readSession(scope.sessionId);
  const project = storageAdapter.getProjectById(scope.projectId);
  if (!session || session.projectId !== scope.projectId || !project) throw new Error('REPLAY_SCOPE_DENIED');
  return project.rootPath;
}
export function registerCaptureReplayHistoryHandlers(): void {
  ipcMain.handle('capture:getReplaySelection', (_event, ...args: unknown[]) => {
    const [scope] = parseIpcArgs(SessionScopeArgsSchema, args, { label: 'capture:getReplaySelection', maxBytes: 1024 });
    return replayHistoryStore.readSelection(authorize(scope), scope.sessionId);
  });
  ipcMain.handle('capture:listReplayHistory', (_event, ...args: unknown[]) => {
    const [request] = parseIpcArgs(z.tuple([history.extend({ afterSequence: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(200).optional() }).strict()]), args, { label: 'capture:listReplayHistory', maxBytes: 2048 });
    return replayHistoryStore.list({ projectRoot: authorize(request), sessionId: request.sessionId, captureSha256: request.captureHash }, request);
  });
  ipcMain.handle('capture:readReplayImage', async (_event, ...args: unknown[]) => {
    const [request] = parseIpcArgs(z.tuple([history.extend({ imageHash: hash }).strict()]), args, { label: 'capture:readReplayImage', maxBytes: 2048 });
    const bytes = await replayHistoryStore.readImage({ projectRoot: authorize(request), sessionId: request.sessionId, captureSha256: request.captureHash }, request.imageHash);
    return `data:image/png;base64,${bytes.toString('base64')}`;
  });
  ipcMain.handle('capture:clearReplayHistory', (_event, ...args: unknown[]) => {
    const [request] = parseIpcArgs(z.tuple([history]), args, { label: 'capture:clearReplayHistory', maxBytes: 2048 });
    return rdxSessionService.clearReplayHistoryForSession(request, request.captureHash, authorize(request));
  });
}
