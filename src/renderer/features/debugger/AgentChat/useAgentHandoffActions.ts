import { isTopLevelAgentId } from '@shared/types/agent';
import type { AppMode } from '@shared/types/session';
import { useConversationStore } from '../../../stores/conversationStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';

export const modeForHandoffAgent = (agentId: string): AppMode =>
  agentId === 'plan'
    ? 'ask'
    : isTopLevelAgentId(agentId) && agentId !== 'plan'
      ? agentId as AppMode
      : 'edit';

export function useAgentHandoffActions(message: {
  projectId: string | null;
  sessionId: string | null;
  runId?: string | null;
}) {
  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useProjectStore((state) => state.currentSession);
  const currentRun = useSessionStore((state) => state.currentRun);
  const upsertConversationMessages = useConversationStore((state) => state.upsertConversationMessages);

  return async (handoff: { agent: string; prompt: string }) => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;
    const result = await electronAPI.conversation.sendMessage({
      projectId: currentProject?.projectId ?? message.projectId ?? null,
      sessionId: currentSession?.sessionId ?? message.sessionId ?? null,
      currentRunId: currentRun?.runId ?? message.runId ?? null,
      mode: modeForHandoffAgent(handoff.agent),
      agentId: handoff.agent,
      message: handoff.prompt,
      attachments: [],
    });
    upsertConversationMessages([result.userMessage, result.assistantDraftMessage]);
  };
}
