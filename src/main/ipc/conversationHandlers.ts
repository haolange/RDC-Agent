import { ipcMain } from 'electron';
import type {
  ConversationAnswerToolApprovalRequest,
  ConversationAnswerUserInputRequest,
  ConversationCancelActiveTurnRequest,
  ConversationRewriteFromMessageRequest,
  ConversationSendRequest,
  ConversationSendResult,
} from '@shared/types/conversation';
import type { ConversationSwitchBranchRequest } from '@shared/types/conversationBranch';
import { conversationService } from '../conversation/ConversationService';
import { storageAdapter } from '../sessions/StorageAdapter';
import type { WorkbenchIpcContext } from './workbenchContext';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import {
  ConversationAnswerToolApprovalArgsSchema,
  ConversationAnswerUserInputArgsSchema,
  ConversationCancelActiveTurnArgsSchema,
  ConversationClearHistoryArgsSchema,
  ConversationCompactHistoryArgsSchema,
  ConversationGetAttachmentPreviewArgsSchema,
  ConversationGetHistoryArgsSchema,
  ConversationGetToolImagePreviewArgsSchema,
  ConversationReleaseAttachmentsArgsSchema,
  ConversationRewriteFromMessageArgsSchema,
  ConversationSendMessageArgsSchema,
  ConversationStageAttachmentsArgsSchema,
  ConversationSwitchBranchArgsSchema,
  ConversationUndoLastTurnArgsSchema,
} from './validation/conversationSchemas';
import { readToolImagePreviewDataUrl } from '../conversation/ToolImagePreviewStore';
import { attachmentStagingService } from '../conversation/AttachmentStagingService';
import {
  assertAttachmentPreviewPath,
  readAttachmentFilePreviewDataUrl,
} from '../conversation/attachmentPreview';
import { NATIVE_IMAGE_MIME_TYPES } from '../conversation/attachmentClassify';
import { toRejectedSendResult } from '../conversation/conversationSendRejection';

export function registerConversationHandlers(context: WorkbenchIpcContext): void {
  attachmentStagingService.clearAll();
  const { state } = context;

  ipcMain.handle('conversation:sendMessage', async (_event, ...rawArgs: unknown[]) => {
    let requestId = 'unknown';
    try {
      const [request] = parseIpcArgs(ConversationSendMessageArgsSchema, rawArgs, {
        label: 'conversation:sendMessage',
        maxBytes: 2 * 1024 * 1024,
      }) as [ConversationSendRequest];
      requestId = request.requestId;
      const result = await conversationService.sendMessage({
        ...request,
        fallbackProjectId: state.currentProjectId,
        fallbackSessionId: state.currentSessionId,
        fallbackRunId: state.currentRunId,
      });

      if (result.session?.projectId) {
        state.currentProjectId = result.session.projectId;
      }
      if (result.session?.sessionId) {
        state.currentSessionId = result.session.sessionId;
        await storageAdapter.setCurrentSessionId(result.session.sessionId);
      }
      if (result.runUpdate?.runId) {
        state.currentRunId = result.runUpdate.runId;
      }

      return {
        status: 'accepted',
        requestId: request.requestId,
        turn: result,
        preparedContext: result.preparedContext,
      } satisfies ConversationSendResult;
    } catch (error) {
      return toRejectedSendResult(requestId, error);
    }
  });

  ipcMain.handle('conversation:rewriteFromMessage', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ConversationRewriteFromMessageArgsSchema, rawArgs, {
      label: 'conversation:rewriteFromMessage',
      maxBytes: 2 * 1024 * 1024,
    }) as [ConversationRewriteFromMessageRequest];
    const result = await conversationService.rewriteFromMessage({
      ...request,
      fallbackProjectId: state.currentProjectId,
      fallbackSessionId: state.currentSessionId,
      fallbackRunId: state.currentRunId,
    });

    if (result.session?.projectId) {
      state.currentProjectId = result.session.projectId;
    }
    if (result.session?.sessionId) {
      state.currentSessionId = result.session.sessionId;
      await storageAdapter.setCurrentSessionId(result.session.sessionId);
    }
    if (result.runUpdate?.runId) {
      state.currentRunId = result.runUpdate.runId;
    }

    return result;
  });

  ipcMain.handle('conversation:getHistory', async (_event, ...rawArgs: unknown[]) => {
    const [sessionId] = parseIpcArgs(ConversationGetHistoryArgsSchema, rawArgs, {
      label: 'conversation:getHistory',
      maxBytes: 4 * 1024,
    });
    if (!sessionId) {
      return { messages: [], branchState: null };
    }
    return conversationService.getHistory(sessionId);
  });

  ipcMain.handle('conversation:switchBranch', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ConversationSwitchBranchArgsSchema, rawArgs, {
      label: 'conversation:switchBranch',
      maxBytes: 4 * 1024,
    }) as [ConversationSwitchBranchRequest];
    return conversationService.switchConversationBranch(request);
  });

  ipcMain.handle('conversation:clearHistory', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [sessionId] = parseIpcArgs(ConversationClearHistoryArgsSchema, rawArgs, {
        label: 'conversation:clearHistory',
        maxBytes: 4 * 1024,
      });
      if (!sessionId) {
        return { success: false, messages: [], error: 'No session selected.' };
      }
      return { success: true, messages: await conversationService.clearHistory(sessionId) };
    } catch (error) {
      return { success: false, messages: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('conversation:undoLastTurn', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [sessionId] = parseIpcArgs(ConversationUndoLastTurnArgsSchema, rawArgs, {
        label: 'conversation:undoLastTurn',
        maxBytes: 4 * 1024,
      });
      if (!sessionId) {
        return { success: false, messages: [], error: 'No session selected.' };
      }
      return { success: true, messages: await conversationService.undoLastTurn(sessionId) };
    } catch (error) {
      return { success: false, messages: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('conversation:compactHistory', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [sessionId] = parseIpcArgs(ConversationCompactHistoryArgsSchema, rawArgs, {
        label: 'conversation:compactHistory',
        maxBytes: 4 * 1024,
      });
      if (!sessionId) {
        return { success: false, messages: [], error: 'No session selected.' };
      }
      const compacted = await conversationService.compactHistory(sessionId);
      return { success: true, ...compacted };
    } catch (error) {
      return { success: false, messages: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('conversation:cancelActiveTurn', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ConversationCancelActiveTurnArgsSchema, rawArgs, {
      label: 'conversation:cancelActiveTurn',
      maxBytes: 4 * 1024,
      padTo: 1,
    }) as [ConversationCancelActiveTurnRequest | undefined];
    return conversationService.cancelActiveTurn(request);
  });

  ipcMain.handle('conversation:answerUserInput', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ConversationAnswerUserInputArgsSchema, rawArgs, {
      label: 'conversation:answerUserInput',
      maxBytes: 256 * 1024,
    }) as [ConversationAnswerUserInputRequest];
    return conversationService.answerUserInput(request);
  });

  ipcMain.handle('conversation:answerToolApproval', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ConversationAnswerToolApprovalArgsSchema, rawArgs, {
      label: 'conversation:answerToolApproval',
      maxBytes: 8 * 1024,
    }) as [ConversationAnswerToolApprovalRequest];
    return conversationService.answerToolApproval(request);
  });

  ipcMain.handle('conversation:getToolImagePreview', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [request] = parseIpcArgs(ConversationGetToolImagePreviewArgsSchema, rawArgs, {
        label: 'conversation:getToolImagePreview',
        maxBytes: 4 * 1024,
      }) as [{ sessionId: string; previewId: string }];
      if (!state.currentSessionId || request.sessionId !== state.currentSessionId) {
        return { dataUrl: null, error: 'IMAGE_PREVIEW_SESSION_DENIED' };
      }
      return { dataUrl: readToolImagePreviewDataUrl(request.sessionId, request.previewId) };
    } catch (error) {
      return { dataUrl: null, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('conversation:stageAttachments', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ConversationStageAttachmentsArgsSchema, rawArgs, {
      label: 'conversation:stageAttachments',
      maxBytes: 96 * 1024 * 1024,
    });
    return { attachments: await attachmentStagingService.stage(request.items, request.composerScopeKey) };
  });

  ipcMain.handle('conversation:releaseAttachments', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ConversationReleaseAttachmentsArgsSchema, rawArgs, {
      label: 'conversation:releaseAttachments',
      maxBytes: 8 * 1024,
    });
    return { released: attachmentStagingService.release(request.stagingIds) };
  });

  ipcMain.handle('conversation:getAttachmentPreview', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [request] = parseIpcArgs(ConversationGetAttachmentPreviewArgsSchema, rawArgs, {
        label: 'conversation:getAttachmentPreview',
        maxBytes: 4 * 1024,
      });
      if (request.sessionId) {
        if (!state.currentSessionId || request.sessionId !== state.currentSessionId) {
          return { dataUrl: null, error: 'IMAGE_PREVIEW_SESSION_DENIED' };
        }
        const attachment = storageAdapter.listSessionAttachments(request.sessionId)
          .find((item) => item.attachmentId === request.previewId);
        if (!attachment || !NATIVE_IMAGE_MIME_TYPES.has(attachment.mimeType)) {
          return { dataUrl: null, error: 'IMAGE_PREVIEW_NOT_FOUND' };
        }
        const safePath = assertAttachmentPreviewPath(
          storageAdapter.getSessionAttachmentsDir(request.sessionId),
          attachment.filePath,
        );
        return { dataUrl: readAttachmentFilePreviewDataUrl(safePath, attachment.mimeType) };
      }
      if (!request.composerScopeKey) {
        return { dataUrl: null, error: 'IMAGE_PREVIEW_SCOPE_DENIED' };
      }
      return { dataUrl: attachmentStagingService.readPreviewDataUrl(request.previewId, request.composerScopeKey) };
    } catch (error) {
      return { dataUrl: null, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
