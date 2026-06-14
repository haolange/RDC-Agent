import { ipcMain } from 'electron';
import type {
  ConversationAnswerToolApprovalRequest,
  ConversationAnswerUserInputRequest,
  ConversationSendRequest,
} from '@shared/types/conversation';
import { conversationService } from '../conversation/ConversationService';
import { storageAdapter } from '../sessions/StorageAdapter';
import { getRegistry } from '../commands/index';
import type { WorkbenchIpcContext } from './workbenchContext';

export function registerConversationHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;

  ipcMain.handle('conversation:sendMessage', async (_event, request: ConversationSendRequest) => {
    const trimmed = request.message.trim();
    // 斜杠命令：路由到 CommandRegistry，将结果作为用户消息注入
    if (trimmed.startsWith('/')) {
      const registry = getRegistry();
      const cmdResult = await registry.execute({
        input: trimmed,
        context: {
          sessionId: state.currentSessionId ?? undefined,
          projectId: state.currentProjectId ?? undefined,
        },
      });
      // 将命令结果注入为 agent message（以系统通知形式显示），保留 sideEffect
      const sideEffectNote = cmdResult.sideEffect ? `\n[sideEffect: ${cmdResult.sideEffect}]` : '';
      const augmentedRequest = {
        ...request,
        message: `[System command: /${trimmed.slice(1)}]\n${cmdResult.message}${sideEffectNote}`,
      };
      const result = await conversationService.sendMessage({
        ...augmentedRequest,
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
    }

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

  ipcMain.handle('conversation:getHistory', async (_event, sessionId: string) => {
    if (!sessionId) {
      return { messages: [] };
    }
    return {
      messages: await conversationService.getHistory(sessionId),
    };
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
