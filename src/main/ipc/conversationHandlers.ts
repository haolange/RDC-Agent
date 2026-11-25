import { ipcMain } from 'electron';
import { AppError } from '@shared/errors/appError';
import { workflowProjectionPublisher } from '../agent-runtime/orchestration/WorkflowProjectionPublisher';
import { conversationService } from '../conversation/ConversationService';
import { conversationHistoryStore, projectWorkspaceStore, sessionRecordStore } from '../sessions/store/sessionStores';
import { readToolImagePreviewDataUrl } from '../agent-runtime/attachments/ToolImagePreviewStore';
import { attachmentStagingService } from '../conversation/AttachmentStagingService';
import {
  assertAttachmentPreviewPath,
  readAttachmentFilePreviewDataUrl,
} from '../runtime/attachmentPreview';
import { NATIVE_IMAGE_MIME_TYPES } from '../runtime/attachmentClassify';
import { delegationTraceStore } from '../agent-runtime/workTrace/DelegationTraceStore';
import { toRejectedSendResult } from '../conversation/conversationSendRejection';
import { requireActiveSessionOwner } from './sessionOwnerGate';
import {
  ConversationAnswerPlanReviewArgsSchema,
  ConversationAnswerToolApprovalArgsSchema,
  ConversationAnswerUserInputArgsSchema,
  ConversationCancelActiveTurnArgsSchema,
  ConversationClearHistoryArgsSchema,
  ConversationGetAttachmentPreviewArgsSchema,
  ConversationGetHistoryArgsSchema,
  ConversationGetMessageSnapshotArgsSchema,
  ConversationGetDelegationTraceArgsSchema,
  ConversationGetDelegationContentArgsSchema,
  ConversationGetToolImagePreviewArgsSchema,
  ConversationReleaseAttachmentsArgsSchema,
  ConversationRewriteFromMessageArgsSchema,
  ConversationSendMessageArgsSchema,
  ConversationStageAttachmentsArgsSchema,
  ConversationSwitchBranchArgsSchema,
  ConversationUndoLastTurnArgsSchema,
} from './validation/conversationSchemas';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import type { WorkbenchIpcContext } from './workbenchContext';
import type { ConversationSwitchBranchRequest } from '@shared/types/conversationBranch';
import type {
  ConversationAnswerToolApprovalRequest,
  ConversationAnswerUserInputRequest,
  ConversationCancelActiveTurnRequest,
  ConversationRewriteFromMessageRequest,
  ConversationSendRequest,
  ConversationSendResult,
} from '@shared/types/conversation';

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

      if (result.session) {
        state.currentProjectId = result.session.record.projectId;
        state.currentSessionId = result.session.record.sessionId;
        projectWorkspaceStore.setCurrentSessionId(result.session.record.sessionId);
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

    if (result.session) {
      state.currentProjectId = result.session.record.projectId;
      state.currentSessionId = result.session.record.sessionId;
      projectWorkspaceStore.setCurrentSessionId(result.session.record.sessionId);
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
      return { messages: [], branchState: null, planReview: null };
    }
    return conversationService.getHistory(sessionId);
  });

  // The renderer missed a streamed update of a message (reload, dropped event); it resumes from the last sent state.
  ipcMain.handle('conversation:getMessageSnapshot', (_event, ...rawArgs: unknown[]) => {
    const [sessionId, messageId] = parseIpcArgs(ConversationGetMessageSnapshotArgsSchema, rawArgs, {
      label: 'conversation:getMessageSnapshot',
      maxBytes: 1024,
    });
    const snapshot = workflowProjectionPublisher.conversationMessageSnapshot(messageId);
    return snapshot?.message.sessionId === sessionId ? snapshot : null;
  });

  ipcMain.handle('conversation:getDelegationTrace', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ConversationGetDelegationTraceArgsSchema, rawArgs, {
      label: 'conversation:getDelegationTrace', maxBytes: 4 * 1024,
    });
    if (!state.currentSessionId || request.sessionId !== state.currentSessionId) {
      return { header: null, steps: [], nextCursor: null, total: 0, error: 'DELEGATION_TRACE_SESSION_DENIED' };
    }
    return delegationTraceStore.read(request.sessionId, request.parentToolCallId, request.cursor, request.pageSize, request.sinceRevision);
  });

  ipcMain.handle('conversation:getDelegationContent', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ConversationGetDelegationContentArgsSchema, rawArgs, {
      label: 'conversation:getDelegationContent', maxBytes: 4 * 1024,
    });
    if (!state.currentSessionId || request.sessionId !== state.currentSessionId) throw new AppError('DELEGATION_CONTENT_SESSION_DENIED');
    return delegationTraceStore.readContent(request.sessionId, request.parentToolCallId,
      { childSessionId: request.childSessionId, executionId: request.executionId, generation: request.generation },
      request.kind, request.offset, request.stepId);
  });

  ipcMain.handle('conversation:switchBranch', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ConversationSwitchBranchArgsSchema, rawArgs, {
      label: 'conversation:switchBranch',
      maxBytes: 4 * 1024,
    }) as [ConversationSwitchBranchRequest];
    requireActiveSessionOwner(state, request.sessionId);
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
      requireActiveSessionOwner(state, sessionId);
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
      requireActiveSessionOwner(state, sessionId);
      return { success: true, messages: await conversationService.undoLastTurn(sessionId) };
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
    const sessionId = requireActiveSessionOwner(state, request?.sessionId ?? state.currentSessionId);
    return conversationService.cancelActiveTurn({ ...request, sessionId });
  });

  ipcMain.handle('conversation:answerUserInput', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ConversationAnswerUserInputArgsSchema, rawArgs, {
      label: 'conversation:answerUserInput',
      maxBytes: 256 * 1024,
    }) as [ConversationAnswerUserInputRequest];
    const sessionId = requireActiveSessionOwner(state, request.sessionId ?? state.currentSessionId);
    return conversationService.answerUserInput({ ...request, sessionId });
  });

  // Failures leave through the IPC error exit as registered codes; a returned value is a committed decision.
  ipcMain.handle('conversation:answerPlanReview', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ConversationAnswerPlanReviewArgsSchema, rawArgs, {
      label: 'conversation:answerPlanReview',
      maxBytes: 32 * 1024,
    });
    if (request.sessionId !== state.currentSessionId) throw new AppError('PLAN_SESSION_DENIED');
    return conversationService.answerPlanReview(request);
  });

  ipcMain.handle('conversation:answerToolApproval', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ConversationAnswerToolApprovalArgsSchema, rawArgs, {
      label: 'conversation:answerToolApproval',
      maxBytes: 8 * 1024,
    }) as [ConversationAnswerToolApprovalRequest];
    const sessionId = requireActiveSessionOwner(state, request.sessionId ?? state.currentSessionId);
    return conversationService.answerToolApproval({ ...request, sessionId });
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
        const attachment = conversationHistoryStore.listSessionAttachments(request.sessionId)
          .find((item) => item.attachmentId === request.previewId);
        if (!attachment || !NATIVE_IMAGE_MIME_TYPES.has(attachment.mimeType)) {
          return { dataUrl: null, error: 'IMAGE_PREVIEW_NOT_FOUND' };
        }
        const safePath = assertAttachmentPreviewPath(
          sessionRecordStore.getSessionAttachmentsDir(request.sessionId),
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
