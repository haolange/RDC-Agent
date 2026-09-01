import type { AgentMode } from '@shared/types/layout';
import type { ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';
import { useConversationStore } from '../../../stores/conversationStore';
import { buildConversationConfigurationCommit } from './composerConfigurationCommit';
import { useSessionStore } from '../../../stores/sessionStore';
import {
  applyConversationTurnResult,
  buildOptimisticConversationTurn,
  removeOptimisticConversationMessages,
  syncE2EConversationState,
  resolveComposerProfileId,
  toConversationAttachmentInputs,
} from './composerSendHelpers';
import { useTurnControlsStore } from './useTurnControls';
import {
  restoreLastSentIfCurrentSession,
  useComposerSessionContextStore,
} from './composerSessionContext';
import { useProjectStore } from '../../../stores/projectStore';
import { persistComposerDraftToSession } from './sessionModelOverride';
import { readComposerEffectiveModel } from './useComposerEffectiveModel';

export function createConversationRequestId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `request-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function sendComposerConversationTurn(options: {
  electronAPI: NonNullable<Window['electronAPI']>;
  trimmed: string;
  pendingAttachments: PendingAttachmentDraft[];
  pendingSkillIds: string[];
  currentMode: AgentMode;
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
  selectedAgentId: string;
  selectedDeviceEntry: { id: string } | undefined;
  setPromptValue: (value: string) => void;
  setPendingAttachments: (value: PendingAttachmentDraft[]) => void;
  setPendingSkillIds: (value: string[]) => void;
  setConversationMessages: (messages: ConversationMessage[]) => void;
  setBranchState: (branchState: ConversationBranchState | null) => void;
  setConversationSnapshot?: (
    messages: ConversationMessage[],
    branchState?: ConversationBranchState | null,
  ) => void;
  upsertConversationMessages: (messages: ConversationMessage[]) => void;
  setCurrentSession: (session: SessionRecord | null) => void;
  setSessions: (sessions: SessionRecord[]) => void;
  setCurrentRun: (run: RunSummary | null) => void;
  setRuns: (runs: RunSummary[]) => void;
  setTracePresentation: (presentation: AgentRunPresentation | null) => void;
  showNotice: (message: string) => void;
  failedSummary: string;
}): Promise<void> {
  const {
    electronAPI,
    trimmed,
    pendingAttachments,
    pendingSkillIds,
    currentMode,
    currentProject,
    currentSession,
    currentRun,
    selectedAgentId,
    selectedDeviceEntry,
    setPromptValue,
    setPendingAttachments,
    setPendingSkillIds,
    setConversationMessages,
    setBranchState,
    setConversationSnapshot,
    upsertConversationMessages,
    setCurrentSession,
    setSessions,
    setCurrentRun,
    setRuns,
    setTracePresentation,
    showNotice,
    failedSummary,
  } = options;

  const sentPrompt = trimmed;
  const sentAttachments = [...pendingAttachments];
  const sentSkillIds = [...pendingSkillIds];
  const requestId = createConversationRequestId();
  const owningSessionId = currentSession?.sessionId ?? null;
  let turnOwnership = {
    sessionId: owningSessionId ?? 'no-session',
    requestId,
    agentId: selectedAgentId,
  };
  const optimistic = buildOptimisticConversationTurn({
    requestId,
    trimmed: sentPrompt,
    currentMode,
    currentProject,
    currentSession,
    currentRun,
    pendingAttachments: sentAttachments,
    selectedAgentId,
  });

  const rollbackOptimistic = () => {
    setConversationMessages(removeOptimisticConversationMessages(
      useConversationStore.getState().allConversationMessages,
      optimistic.optimisticIds,
    ));
  };

  useComposerSessionContextStore.getState().beginTurn({
    ...turnOwnership,
    projectId: currentProject?.projectId ?? null,
    optimisticTurnId: optimistic.assistantDraftMessage.turnId,
    realTurnId: null,
  });
  setPromptValue('');
  setPendingAttachments([]);
  setPendingSkillIds([]);
  useSessionStore.getState().setPreparedTurnContext(null);
  useSessionStore.getState().setConversationPreparationPhase('preparing');
  upsertConversationMessages([optimistic.userMessage, optimistic.assistantDraftMessage]);

  const restoreComposerDraft = () => {
    const activeSessionId = useProjectStore.getState().currentSession?.sessionId ?? null;
    if (owningSessionId && activeSessionId !== owningSessionId) {
      return;
    }
    const restored = restoreLastSentIfCurrentSession(activeSessionId ?? owningSessionId, (lastSent) => {
      setPromptValue(lastSent.prompt);
      setPendingAttachments(lastSent.attachments);
      setPendingSkillIds(lastSent.skillIds);
    });
    if (!restored) {
      setPromptValue(sentPrompt);
      setPendingAttachments(sentAttachments);
      setPendingSkillIds(sentSkillIds);
    }
  };

  const finishRevokedOrCancelled = (): boolean => {
    if (!useConversationStore.getState().consumeRevokedRequest(requestId)) {
      return false;
    }
    // Stop already performed a clean preparing revoke; stay idempotent.
    useComposerSessionContextStore.getState().clearActiveTurnIfOwned(turnOwnership);
    useSessionStore.getState().setPreparedTurnContext(null);
    useSessionStore.getState().setConversationPreparationPhase('idle');
    return true;
  };

  const isRequestCancelledError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('REQUEST_CANCELLED');
  };

  try {
    const configuration = await buildConversationConfigurationCommit({
      selectedAgentId,
      currentProjectId: currentProject?.projectId,
      getEffectiveCatalog: (providerId) => electronAPI.settings.getEffectiveCatalog(providerId),
      modelOverride: readComposerEffectiveModel(
        selectedAgentId,
        currentSession,
        currentProject?.projectId,
      ),
    });
    const profileId = resolveComposerProfileId(currentMode, selectedAgentId);
    const turnControls = { ...useTurnControlsStore.getState().turnControls };
    const result = await electronAPI.conversation.sendMessage({
      requestId,
      projectId: currentProject?.projectId ?? null,
      sessionId: currentSession?.sessionId ?? null,
      currentRunId: currentRun?.runId ?? null,
      replayDeviceId: selectedDeviceEntry?.id ?? null,
      agentId: selectedAgentId || null,
      profileId,
      message: sentPrompt,
      attachments: toConversationAttachmentInputs(sentAttachments),
      preloadSkillIds: sentSkillIds,
      turnControls,
      configurationCommit: configuration.configurationCommit,
    });

    if (finishRevokedOrCancelled()) {
      return;
    }

    if (result.status === 'rejected') {
      if (result.error.code === 'REQUEST_CANCELLED') {
        rollbackOptimistic();
        restoreComposerDraft();
        useComposerSessionContextStore.getState().clearActiveTurnIfOwned(turnOwnership);
        useSessionStore.getState().setPreparedTurnContext(null);
        useSessionStore.getState().setConversationPreparationPhase('idle');
        return;
      }
      rollbackOptimistic();
      restoreComposerDraft();
      useComposerSessionContextStore.getState().clearActiveTurnIfOwned(turnOwnership);
      useSessionStore.getState().setPreparedTurnContext(null);
      useSessionStore.getState().setConversationPreparationPhase('idle');
      showNotice(result.error.message || failedSummary);
      return;
    }

    const stagedIds = sentAttachments
      .map((attachment) => attachment.stagingId)
      .filter((stagingId): stagingId is string => Boolean(stagingId));
    if (stagedIds.length > 0) {
      void electronAPI.conversation.releaseAttachments({ stagingIds: stagedIds });
    }

    // Drop optimistic placeholders before applying authoritative turn messages.
    rollbackOptimistic();

    const turn = result.turn;
    const committedSessionId = turn.session?.sessionId
      ?? turn.userMessage.sessionId
      ?? turn.assistantDraftMessage.sessionId
      ?? turnOwnership.sessionId;
    useComposerSessionContextStore.getState().setRealTurnId(
      turnOwnership,
      turn.userMessage.turnId,
      committedSessionId,
    );
    turnOwnership = { ...turnOwnership, sessionId: committedSessionId };
    useSessionStore.getState().setPreparedTurnContext(result.preparedContext);
    useSessionStore.getState().setConversationPreparationPhase('current');

    await applyConversationTurnResult({
      electronAPI,
      result: turn,
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
    await persistComposerDraftToSession(
      turn.session?.sessionId ?? committedSessionId,
      currentProject?.projectId,
    );

    await syncE2EConversationState({
      electronAPI,
      sessionId: turn.session?.sessionId ?? currentSession?.sessionId ?? null,
      turnId: turn.userMessage.turnId,
      setConversationMessages,
      setTracePresentation,
      setBranchState,
    });
    useComposerSessionContextStore.getState().clearActiveTurnIfOwned(turnOwnership);
  } catch (error) {
    if (finishRevokedOrCancelled()) {
      return;
    }
    rollbackOptimistic();
    restoreComposerDraft();
    useComposerSessionContextStore.getState().clearActiveTurnIfOwned(turnOwnership);
    useSessionStore.getState().setPreparedTurnContext(null);
    useSessionStore.getState().setConversationPreparationPhase('idle');
    if (isRequestCancelledError(error)) {
      return;
    }
    showNotice(error instanceof Error ? error.message : failedSummary);
  }
}
