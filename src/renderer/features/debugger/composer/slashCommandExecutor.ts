import type { AgentMode } from '@shared/types/layout';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';

export async function executeSlashCommand(
  input: string,
  context: {
    currentSession: SessionRecord | null;
    currentProject: ProjectRecord | null;
    selectedAgentId: string;
    setCurrentMode: (mode: AgentMode) => void;
    setConversationMessages: (messages: import('@shared/types/conversation').ConversationMessage[]) => void;
    upsertConversationMessages: (messages: import('@shared/types/conversation').ConversationMessage[]) => void;
    showNotice: (message: string) => void;
  },
): Promise<boolean> {
  const electronAPI = window.electronAPI;
  if (!electronAPI) return false;

  try {
    const response = await electronAPI.command.execute({
      input,
      context: {
        sessionId: context.currentSession?.sessionId,
        projectId: context.currentProject?.projectId,
        workspaceRoot: context.currentProject?.rootPath,
        agentId: context.selectedAgentId,
      },
    });

    if (response.systemMessage) {
      context.upsertConversationMessages([response.systemMessage]);
    }

    if (response.result.uiAction) {
      const action = response.result.uiAction;
      if (action.type === 'switch-mode' && action.payload && typeof action.payload === 'object' && 'agentId' in action.payload) {
        context.setCurrentMode((action.payload as { agentId: string }).agentId as AgentMode);
      }
    }

    if (response.result.invalidateStores?.includes('conversation')) {
      if (context.currentSession?.sessionId) {
        const history = await electronAPI.conversation.getHistory(context.currentSession.sessionId);
        context.setConversationMessages(history.messages);
      }
    }

    return true;
  } catch (error) {
    context.showNotice(error instanceof Error ? error.message : 'Command failed');
    return true;
  }
}
