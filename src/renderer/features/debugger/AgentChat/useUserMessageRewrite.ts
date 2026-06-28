import { useCallback, useMemo } from 'react';
import type { ConversationMessage } from '@shared/types/conversation';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useConversationStore } from '../../../stores/conversationStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import {
  applyConversationTurnResult,
  syncE2EConversationState,
} from '../composer/composerSendHelpers';

export function useUserMessageRewrite(message: ConversationMessage) {
  const conversationMessages = useConversationStore((state) => state.conversationMessages);
  const setConversationMessages = useConversationStore((state) => state.setConversationMessages);
  const setBranchState = useConversationStore((state) => state.setBranchState);
  const upsertConversationMessages = useConversationStore((state) => state.upsertConversationMessages);
  const currentProject = useProjectStore((state) => state.currentProject);
  const setSessions = useProjectStore((state) => state.setSessions);
  const setCurrentSession = useProjectStore((state) => state.setCurrentSession);
  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setRuns = useSessionStore((state) => state.setRuns);
  const setTracePresentation = useWorkflowStore((state) => state.setTracePresentation);

  const pairedAssistant = useMemo(
    () => conversationMessages.find((entry) => entry.turnId === message.turnId && entry.role === 'assistant') ?? null,
    [conversationMessages, message.turnId],
  );

  return useCallback(async (nextContent: string) => {
    const electronAPI = getElectronApi();
    if (!electronAPI) {
      throw new Error('App bridge is not available.');
    }

    const previousMessages = useConversationStore.getState().conversationMessages;
    const previousBranchState = useConversationStore.getState().branchState;

    try {
      const result = await electronAPI.conversation.rewriteFromMessage({
        messageId: message.id,
        projectId: message.projectId ?? currentProject?.projectId ?? null,
        sessionId: message.sessionId,
        currentRunId: message.runId ?? null,
        replayDeviceId: null,
        mode: message.modeContext ?? 'ask',
        agentId: pairedAssistant?.agentId ?? null,
        message: nextContent,
        attachments: message.attachments?.map((attachment) => ({
          sourcePath: attachment.filePath,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          size: attachment.size,
        })) ?? [],
      });

      await applyConversationTurnResult({
        electronAPI,
        result,
        currentProject,
        setCurrentSession,
        setSessions,
        setCurrentRun,
        setRuns,
        setTracePresentation,
        upsertConversationMessages,
      });

      if (message.sessionId) {
        const historyResult = await electronAPI.conversation.getHistory(message.sessionId);
        setConversationMessages(historyResult.messages ?? []);
        setBranchState(historyResult.branchState ?? null);
      }

      await syncE2EConversationState({
        electronAPI,
        sessionId: result.session?.sessionId ?? message.sessionId,
        turnId: result.userMessage.turnId,
        setConversationMessages,
        setTracePresentation,
      });
    } catch (error) {
      setConversationMessages(previousMessages);
      setBranchState(previousBranchState);
      throw error;
    }
  }, [
    currentProject,
    message,
    pairedAssistant,
    setBranchState,
    setConversationMessages,
    setCurrentRun,
    setCurrentSession,
    setRuns,
    setSessions,
    setTracePresentation,
    upsertConversationMessages,
  ]);
}
