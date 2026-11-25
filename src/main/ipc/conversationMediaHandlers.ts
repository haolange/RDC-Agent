import { join } from 'node:path';
import { ipcMain, shell } from 'electron';
import { pruneAttachmentDocumentCopies } from '../conversation/AttachmentDocumentOpen';
import { attachmentStagingService } from '../conversation/AttachmentStagingService';
import { accessOwnedAttachment, type OwnedAttachment } from '../conversation/ConversationAttachmentAccess';
import { layerFromPersistedKind } from '../conversation/attachmentClassify';
import { resolveConversationMedia } from '../conversation/ConversationMediaResolver';
import { sessionArtifactResolver } from '../sessions/artifacts/SessionArtifactResolver';
import { conversationHistoryStore, sessionRecordStore } from '../sessions/store/sessionStores';
import { appPathService } from '../runtime/AppPathService';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { ConversationAccessAttachmentArgsSchema, ConversationResolveMediaArgsSchema } from './validation/conversationSchemas';
import type { WorkbenchIpcContext } from './workbenchContext';

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Media an answer embeds, resolved only inside the current session's artifacts, attachments and project. */
export function registerConversationMediaHandlers({ state }: WorkbenchIpcContext): void {
  const documentCopyRoot = join(appPathService.getAppStatePaths().appStateRoot, 'attachment-open-copies');
  void pruneAttachmentDocumentCopies(documentCopyRoot);
  ipcMain.handle('conversation:accessAttachment', async (_event, ...rawArgs: unknown[]) => {
    const [{ owner, action }] = parseIpcArgs(ConversationAccessAttachmentArgsSchema, rawArgs, {
      label: 'conversation:accessAttachment', maxBytes: 4 * 1024,
    });
    let attachment: OwnedAttachment | undefined;
    try {
      if (owner.scope === 'session') {
        if (owner.sessionId !== state.currentSessionId) return { kind: 'error', code: 'denied' };
        const record = conversationHistoryStore.listSessionAttachments(owner.sessionId)
          .find((item) => item.attachmentId === owner.attachmentId && item.sessionId === owner.sessionId);
        if (record) attachment = {
          ...record,
          layer: record.layer ?? layerFromPersistedKind(record.kind, record.mimeType, record.fileName),
          root: sessionRecordStore.getSessionAttachmentsDir(owner.sessionId),
        };
      } else {
        attachment = attachmentStagingService.getOwnedAttachment(owner.stagingId, owner.composerScopeKey);
      }
      if (!attachment) return { kind: 'error', code: 'unavailable' };
      const stillOwned = () => owner.scope === 'session' ? state.currentSessionId === owner.sessionId
        : Boolean(attachmentStagingService.getOwnedAttachment(owner.stagingId, owner.composerScopeKey));
      return await accessOwnedAttachment(attachment, action, shell, stillOwned, documentCopyRoot);
    } catch (error) {
      // A file that vanished between listing and reading is an ordinary outcome; anything else is a real fault.
      if (isMissingFileError(error)) return { kind: 'error', code: 'unavailable' };
      throw error;
    }
  });

  ipcMain.handle('conversation:resolveMedia', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ConversationResolveMediaArgsSchema, rawArgs, {
      label: 'conversation:resolveMedia',
      maxBytes: 8 * 1024,
    });
    if (!state.currentSessionId || request.sessionId !== state.currentSessionId) {
      return { dataUrl: null, error: 'MEDIA_SCOPE_DENIED' };
    }
    const location = sessionRecordStore.findSessionLocation(request.sessionId);
    return resolveConversationMedia(request.src, {
      resolveArtifact: (uri) => sessionArtifactResolver.resolve(request.sessionId, uri).absolutePath,
      projectRoot: location?.project.rootPath ?? null,
      attachmentsRoot: sessionRecordStore.getSessionAttachmentsDir(request.sessionId),
      attachments: conversationHistoryStore.listSessionAttachments(request.sessionId),
    });
  });
}
