import { ipcMain } from 'electron';
import type {
  ConversationAnswerToolApprovalRequest,
  ConversationAnswerUserInputRequest,
  ConversationCancelActiveTurnRequest,
  ConversationPreflightErrorCode,
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
  ConversationGetHistoryArgsSchema,
  ConversationGetToolImagePreviewArgsSchema,
  ConversationRewriteFromMessageArgsSchema,
  ConversationSendMessageArgsSchema,
  ConversationSwitchBranchArgsSchema,
  ConversationUndoLastTurnArgsSchema,
} from './validation/conversationSchemas';
import { readToolImagePreviewDataUrl } from '../conversation/ToolImagePreviewStore';

const PREFLIGHT_ERROR_CODES = new Set<ConversationPreflightErrorCode>([
  'REQUEST_CANCELLED',
  'CONVERSATION_BUSY',
  'AGENT_COMMIT_NOT_FOUND',
  'AGENT_PROFILE_UNAVAILABLE',
  'PROVIDER_UNAVAILABLE',
  'MODEL_UNAVAILABLE',
  'NO_USABLE_CONTEXT_TIER',
  'PLAN_CONFLICT',
  'CONSTRAINT_REJECTED',
  'ATTACHMENT_INVALID',
  'ATTACHMENT_UNSUPPORTED',
  'PROMPT_PLAN_UNAVAILABLE',
  'PROMPT_OVERHEAD_EXCEEDS_BUDGET',
  'CONTEXT_CANNOT_FIT',
  'TURN_COMMIT_FAILED',
  'PREFLIGHT_FAILED',
]);

function toRejectedSendResult(requestId: string, error: unknown): ConversationSendResult {
  const technicalMessage = error instanceof Error ? error.message : String(error);
  const matchedCode = technicalMessage.match(/^([A-Z][A-Z0-9_]+):\s*/u)?.[1];
  const code = matchedCode && PREFLIGHT_ERROR_CODES.has(matchedCode as ConversationPreflightErrorCode)
    ? matchedCode as ConversationPreflightErrorCode
    : 'PREFLIGHT_FAILED';
  const message = technicalMessage.replace(/^([A-Z][A-Z0-9_]+):\s*/u, '').trim()
    || 'The request could not be prepared.';
  return {
    status: 'rejected',
    requestId,
    phase: code === 'TURN_COMMIT_FAILED' ? 'commit' : 'preflight',
    error: {
      code,
      message,
      technicalMessage,
      retryable: code === 'REQUEST_CANCELLED'
        || code === 'CONVERSATION_BUSY'
        || code === 'PROVIDER_UNAVAILABLE'
        || code === 'PREFLIGHT_FAILED',
    },
  };
}

export function registerConversationHandlers(context: WorkbenchIpcContext): void {
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
}
