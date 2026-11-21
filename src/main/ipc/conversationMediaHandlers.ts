import { ipcMain } from 'electron';
import { resolveConversationMedia } from '../conversation/ConversationMediaResolver';
import { sessionArtifactResolver } from '../sessions/artifacts/SessionArtifactResolver';
import { storageAdapter } from '../sessions/store/StorageAdapter';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { ConversationResolveMediaArgsSchema } from './validation/conversationSchemas';
import type { WorkbenchIpcContext } from './workbenchContext';

/** Media an answer embeds, resolved only inside the current session's artifacts, attachments and project. */
export function registerConversationMediaHandlers({ state }: WorkbenchIpcContext): void {
  ipcMain.handle('conversation:resolveMedia', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ConversationResolveMediaArgsSchema, rawArgs, {
      label: 'conversation:resolveMedia',
      maxBytes: 8 * 1024,
    });
    if (!state.currentSessionId || request.sessionId !== state.currentSessionId) {
      return { dataUrl: null, error: 'MEDIA_SCOPE_DENIED' };
    }
    const location = storageAdapter.sessions.findSessionLocation(request.sessionId);
    return resolveConversationMedia(request.src, {
      resolveArtifact: (uri) => sessionArtifactResolver.resolve(request.sessionId, uri).absolutePath,
      projectRoot: location?.project.rootPath ?? null,
      attachmentsRoot: storageAdapter.getSessionAttachmentsDir(request.sessionId),
      attachments: storageAdapter.listSessionAttachments(request.sessionId),
    });
  });
}
