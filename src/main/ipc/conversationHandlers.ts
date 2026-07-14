import { ipcMain } from 'electron';
import type {
  ConversationAnswerToolApprovalRequest,
  ConversationAnswerUserInputRequest,
  NextRequestContextPreviewRequest,
  ConversationRewriteFromMessageRequest,
  ConversationSendRequest,
} from '@shared/types/conversation';
import { conversationService } from '../conversation/ConversationService';
import { storageAdapter } from '../sessions/StorageAdapter';
import type { WorkbenchIpcContext } from './workbenchContext';

export function registerConversationHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;

  ipcMain.handle('conversation:sendMessage', async (_event, request: ConversationSendRequest) => {
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

    return result;
  });

  ipcMain.handle(
    'conversation:previewNextRequestContext',
    async (_event, request: NextRequestContextPreviewRequest) => (
      conversationService.previewNextRequestContext({
        ...request,
        fallbackProjectId: state.currentProjectId,
        fallbackSessionId: state.currentSessionId,
        fallbackRunId: state.currentRunId,
      })
    ),
  );

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
      return { success: true, messages: await conversationService.compactHistory(sessionId) };
    } catch (error) {
      return { success: false, messages: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('conversation:cancelActiveTurn', async (_event, request?: { sessionId?: string; turnId?: string }) => {
    return conversationService.cancelActiveTurn(request);
  });

  ipcMain.handle('conversation:answerUserInput', async (_event, request: ConversationAnswerUserInputRequest) => {
    return conversationService.answerUserInput(request);
  });

  ipcMain.handle('conversation:answerToolApproval', async (_event, request: ConversationAnswerToolApprovalRequest) => {
    return conversationService.answerToolApproval(request);
  });
}
