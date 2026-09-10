import { useCallback } from 'react';
import type { ConversationMessage } from '@shared/types/conversation';
import { getElectronApi } from '../../platform/getElectronApi';
import { useConversationStore } from '../../stores/conversationStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import {
  applyConversationTurnResult,
  removeOptimisticConversationMessages,
  syncE2EConversationState,
} from '../../stores/conversationSendHelpers';
import { useTurnControlsStore } from '../../stores/turnControlsStore';
import { createConversationRequestId } from '../../services/conversationRequestId';
import { buildConversationConfigurationCommit } from '../../stores/conversationConfigurationCommit';
import { resolveComposerProfileId } from '../../stores/conversationSendHelpers';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { readComposerEffectiveModel } from '../../hooks/useComposerEffectiveModel';
import { buildOptimisticRewriteSnapshot } from './optimisticRewriteSnapshot';

export function isRewriteTurnStillCurrent(turnId: string, activeLeafBranchId?: string | null): boolean {
  const state = useConversationStore.getState();
  if (activeLeafBranchId && state.branchState?.activeLeafBranchId !== activeLeafBranchId) {
    return false;
  }
  return state.conversationMessages.some((entry) => entry.turnId === turnId && entry.role === 'user');
}

export function useUserMessageRewrite(message: ConversationMessage) {
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

  return useCallback(async (nextContent: string) => {
    const electronAPI = getElectronApi();
    if (!electronAPI) {
      throw new Error('App bridge is not available.');
    }

    const previousMessages = useConversationStore.getState().allConversationMessages;
    const previousBranchState = useConversationStore.getState().branchState;
    const requestId = createConversationRequestId();
    const rewriteAgentId = useLayoutStore.getState().selectedAgentId || 'general';
    const turnOwnership = {
      sessionId: message.sessionId ?? 'no-session',
      requestId,
      agentId: rewriteAgentId,
    };
    const optimistic = buildOptimisticRewriteSnapshot({
      requestId,
      sourceMessage: message,
      nextContent,
      allMessages: previousMessages,
      branchState: previousBranchState,
      agentId: rewriteAgentId,
    });

    setConversationSnapshot(optimistic.messages, optimistic.branchState);
    useSessionStore.getState().setConversationPreparationPhase('preparing');
    useComposerSessionContextStore.getState().beginTurn({
      ...turnOwnership,
      projectId: message.projectId ?? currentProject?.projectId ?? null,
      optimisticTurnId: optimistic.optimisticTurnId,
      realTurnId: null,
    });

    try {
      const configuration = await buildConversationConfigurationCommit({
        selectedAgentId: rewriteAgentId,
        currentProjectId: currentProject?.projectId,
        getEffectiveCatalog: (providerId) => electronAPI.settings.getEffectiveCatalog(providerId),
        modelOverride: readComposerEffectiveModel(
          rewriteAgentId,
          useProjectStore.getState().currentSession,
          currentProject?.projectId,
        ),
      });
      const result = await electronAPI.conversation.rewriteFromMessage({
        requestId,
        messageId: message.id,
        projectId: message.projectId ?? currentProject?.projectId ?? null,
        sessionId: message.sessionId,
        currentRunId: message.runId ?? null,
        replayDeviceId: null,
        agentId: rewriteAgentId,
        profileId: resolveComposerProfileId(useLayoutStore.getState().currentMode, rewriteAgentId),
        message: nextContent,
        attachments: message.attachments?.map((attachment) => ({
          sourcePath: attachment.filePath,
          material: attachment.material,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          size: attachment.size,
        })) ?? [],
        turnControls: { ...useTurnControlsStore.getState().turnControls },
        configurationCommit: configuration.configurationCommit,
      });

      if (useConversationStore.getState().consumeRevokedRequest(requestId)) {
        useComposerSessionContextStore.getState().clearActiveTurnIfOwned(turnOwnership);
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

      useComposerSessionContextStore.getState().setRealTurnId(
        turnOwnership,
        result.userMessage.turnId,
        result.session?.sessionId ?? result.userMessage.sessionId ?? result.assistantDraftMessage.sessionId,
      );

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
        useComposerSessionContextStore.getState().clearActiveTurnIfOwned(turnOwnership);
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
      useComposerSessionContextStore.getState().clearActiveTurnIfOwned(turnOwnership);
      useSessionStore.getState().setPreparedTurnContext(null);
      useSessionStore.getState().setConversationPreparationPhase('idle');
      throw error;
    }
  }, [
    currentProject,
    message,
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
