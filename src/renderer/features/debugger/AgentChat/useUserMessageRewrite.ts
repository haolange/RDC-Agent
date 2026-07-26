import { useCallback, useMemo } from 'react';
import type { ConversationMessage } from '@shared/types/conversation';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useConversationStore } from '../../../stores/conversationStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import {
  applyConversationTurnResult,
  removeOptimisticConversationMessages,
  syncE2EConversationState,
} from '../composer/composerSendHelpers';
import { useTurnControlsStore } from '../composer/useTurnControls';
import { createConversationRequestId } from '../composer/composerSendFlow';
import { useComposerSessionContextStore } from '../composer/composerSessionContext';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { buildOptimisticRewriteSnapshot } from './optimisticRewriteSnapshot';

export function isRewriteTurnStillCurrent(turnId: string, activeLeafBranchId?: string | null): boolean {
  const state = useConversationStore.getState();
  if (activeLeafBranchId && state.branchState?.activeLeafBranchId !== activeLeafBranchId) {
    return false;
  }
  return state.conversationMessages.some((entry) => entry.turnId === turnId && entry.role === 'user');
}

export function useUserMessageRewrite(message: ConversationMessage) {
  const conversationMessages = useConversationStore((state) => state.conversationMessages);
  const setConversationMessages = useConversationStore((state) => state.setConversationMessages);
  const setBranchState = useConversationStore((state) => state.setBranchState);
  const setConversationSnapshot = useConversationStore((state) => state.setConversationSnapshot);
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

    const previousMessages = useConversationStore.getState().allConversationMessages;
    const previousBranchState = useConversationStore.getState().branchState;
    const requestId = createConversationRequestId();
    const optimistic = buildOptimisticRewriteSnapshot({
      requestId,
      sourceMessage: message,
      nextContent,
      allMessages: previousMessages,
      branchState: previousBranchState,
      agentId: pairedAssistant?.agentId ?? null,
    });

    setConversationSnapshot(optimistic.messages, optimistic.branchState);
    useSessionStore.getState().setConversationPreparationPhase('preparing');
    useComposerSessionContextStore.getState().beginTurn({
      sessionId: message.sessionId ?? 'no-session',
      projectId: message.projectId ?? currentProject?.projectId ?? null,
      requestId,
      optimisticTurnId: optimistic.optimisticTurnId,
      realTurnId: null,
    });

    try {
      const routeAgentId = pairedAssistant?.agentId ?? null;
      const agentCommit = routeAgentId
        ? await useAppSettingsStore.getState().flushAgentDefinitionSaves(routeAgentId)
        : null;
      const result = await electronAPI.conversation.rewriteFromMessage({
        requestId,
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
        turnControls: { ...useTurnControlsStore.getState().turnControls },
        configurationCommit: routeAgentId ? {
          agentId: routeAgentId,
          agentCommitHash: agentCommit?.commitHash,
          providerId: agentCommit?.route?.providerId,
        } : undefined,
      });

      if (useConversationStore.getState().consumeRevokedRequest(requestId)) {
        useComposerSessionContextStore.getState().clearActiveTurn();
        useSessionStore.getState().setPreparedTurnContext(null);
        useSessionStore.getState().setConversationPreparationPhase('idle');
        return;
      }

      // Drop optimistic placeholders before applying authoritative rewrite messages.
      const optimisticIds = optimistic.messages
        .filter((entry) => entry.requestId === requestId)
        .map((entry) => entry.id);
      setConversationMessages(removeOptimisticConversationMessages(
        useConversationStore.getState().allConversationMessages,
        optimisticIds,
      ));

      useComposerSessionContextStore.getState().setRealTurnId(result.userMessage.turnId);

      await applyConversationTurnResult({
        electronAPI,
        result,
        currentProject,
        setCurrentSession,
        setSessions,
        setCurrentRun,
        setRuns,
        setTracePresentation,
        setConversationMessages,
        setBranchState,
        setConversationSnapshot,
        upsertConversationMessages,
      });

      if (useConversationStore.getState().monotonicStoppedRequestIds.includes(requestId)) {
        useComposerSessionContextStore.getState().clearActiveTurn();
        useSessionStore.getState().setConversationPreparationPhase('idle');
        return;
      }

      useSessionStore.getState().setPreparedTurnContext(result.preparedContext);
      useSessionStore.getState().setConversationPreparationPhase('current');

      void syncE2EConversationState({
        electronAPI,
        sessionId: result.session?.sessionId ?? message.sessionId,
        turnId: result.userMessage.turnId,
        setConversationMessages,
        setTracePresentation,
        setBranchState,
        shouldApply: () => isRewriteTurnStillCurrent(
          result.userMessage.turnId,
          result.branchState?.activeLeafBranchId,
        ),
      }).catch((error) => {
        console.warn('[conversation] Rewrite terminal sync failed.', error);
      });
    } catch (error) {
      setConversationSnapshot(previousMessages, previousBranchState);
      useComposerSessionContextStore.getState().clearActiveTurn();
      useSessionStore.getState().setPreparedTurnContext(null);
      useSessionStore.getState().setConversationPreparationPhase('idle');
      throw error;
    }
  }, [
    currentProject,
    message,
    pairedAssistant,
    setBranchState,
    setConversationMessages,
    setConversationSnapshot,
    setCurrentRun,
    setCurrentSession,
    setRuns,
    setSessions,
    setTracePresentation,
    upsertConversationMessages,
  ]);
}
