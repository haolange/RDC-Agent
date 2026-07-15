import { isTopLevelAgentId } from '@shared/types/agent';
import type { AppMode } from '@shared/types/session';
import { useConversationStore } from '../../../stores/conversationStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { createConversationRequestId } from '../composer/composerSendFlow';
import { useTurnControlsStore } from '../composer/useTurnControls';

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
    const agentCommit = await useAppSettingsStore.getState().flushAgentDefinitionSaves(handoff.agent);
    const result = await electronAPI.conversation.sendMessage({
      requestId: createConversationRequestId(),
      projectId: currentProject?.projectId ?? message.projectId ?? null,
      sessionId: currentSession?.sessionId ?? message.sessionId ?? null,
      currentRunId: currentRun?.runId ?? message.runId ?? null,
      mode: modeForHandoffAgent(handoff.agent),
      agentId: handoff.agent,
      message: handoff.prompt,
      attachments: [],
      turnControls: { ...useTurnControlsStore.getState().turnControls },
      configurationCommit: {
        agentId: handoff.agent,
        agentCommitHash: agentCommit?.commitHash,
        providerId: agentCommit?.route?.providerId,
      },
    });
    if (result.status === 'rejected') throw new Error(result.error.message);
    upsertConversationMessages([result.turn.userMessage, result.turn.assistantDraftMessage]);
  };
}
