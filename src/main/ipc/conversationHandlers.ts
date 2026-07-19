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
import { conversationService } from '../conversation/ConversationService';
import { storageAdapter } from '../sessions/StorageAdapter';
import type { WorkbenchIpcContext } from './workbenchContext';

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

  ipcMain.handle('conversation:sendMessage', async (_event, request: ConversationSendRequest) => {
    try {
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
      return toRejectedSendResult(request.requestId, error);
    }
  });

  ipcMain.handle('conversation:rewriteFromMessage', async (_event, request: ConversationRewriteFromMessageRequest) => {
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

  ipcMain.handle('conversation:getHistory', async (_event, sessionId: string) => {
    if (!sessionId) {
      return { messages: [], branchState: null };
    }
    return conversationService.getHistory(sessionId);
  });

  ipcMain.handle('conversation:switchBranch', async (_event, request: import('@shared/types/conversationBranch').ConversationSwitchBranchRequest) => {
    return conversationService.switchConversationBranch(request);
  });

  ipcMain.handle('conversation:clearHistory', async (_event, sessionId: string) => {
    if (!sessionId) {
      return { success: false, messages: [], error: 'No session selected.' };
    }
    try {
      return { success: true, messages: await conversationService.clearHistory(sessionId) };
    } catch (error) {
      return { success: false, messages: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('conversation:undoLastTurn', async (_event, sessionId: string) => {
    if (!sessionId) {
      return { success: false, messages: [], error: 'No session selected.' };
    }
    try {
      return { success: true, messages: await conversationService.undoLastTurn(sessionId) };
    } catch (error) {
      return { success: false, messages: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('conversation:compactHistory', async (_event, sessionId: string) => {
    if (!sessionId) {
      return { success: false, messages: [], error: 'No session selected.' };
    }
    try {
      const compacted = await conversationService.compactHistory(sessionId);
      return { success: true, ...compacted };
    } catch (error) {
      return { success: false, messages: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('conversation:cancelActiveTurn', async (_event, request?: ConversationCancelActiveTurnRequest) => {
    return conversationService.cancelActiveTurn(request);
  });

  ipcMain.handle('conversation:answerUserInput', async (_event, request: ConversationAnswerUserInputRequest) => {
    return conversationService.answerUserInput(request);
  });

  ipcMain.handle('conversation:answerToolApproval', async (_event, request: ConversationAnswerToolApprovalRequest) => {
    return conversationService.answerToolApproval(request);
  });
}
