import { errorCodeOf } from '@shared/errors/appError';
import { selectOrderedConversationMessages, useConversationStore } from '../../stores/conversationStore';
import { findPlanReview } from '../../lib/transcriptPlanLocation';
import { errorDetail } from '../../lib/errorDetail';
import { buildConversationConfigurationCommit } from '../../stores/conversationConfigurationCommit';
import { useSessionStore } from '../../stores/sessionStore';
import {
  applyConversationTurnResult,
  buildOptimisticConversationTurn,
  removeRequestMessages,
  resolveComposerProfileId,
  toConversationAttachmentInputs,
} from '../../stores/conversationSendHelpers';
import { useTurnControlsStore } from '../../stores/turnControlsStore';
import {
  restoreLastSentIfCurrentSession,
  useComposerSessionContextStore,
} from '../../stores/composerSessionContextStore';
import { useProjectStore } from '../../stores/projectStore';
import { readComposerEffectiveModel } from '../../hooks/useComposerEffectiveModel';
import { createConversationRequestId } from '../../services/conversationRequestId';
import { notify } from '../../stores/notificationStore';
import { persistComposerDraftToSession } from './sessionModelOverride';
import { inspectHandoffCommit, type ComposerSendOutcome } from './composerHandoffSend';
import type { PendingAttachmentDraft } from '../../types/attachments';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import type { Translator } from '../../i18n/messages';

export { createConversationRequestId };

export async function sendComposerConversationTurn(options: {
  electronAPI: NonNullable<Window['electronAPI']>;
  trimmed: string;
  pendingAttachments: PendingAttachmentDraft[];
  pendingSkillIds: string[];
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
  setSessions: (sessions: SessionRecord[]) => void;
  setCurrentRun: (run: RunSummary | null) => void;
  setRuns: (runs: RunSummary[]) => void;
  setTracePresentation: (presentation: AgentRunPresentation | null) => void;
  t: Translator;
  preserveDraft?: boolean;
  planReference?: import('@shared/types/planReview').PlanReferenceRequest;
}): Promise<ComposerSendOutcome> {
  const {
    electronAPI,
    trimmed,
    pendingAttachments,
    pendingSkillIds,
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
    setSessions,
    setCurrentRun,
    setRuns,
    setTracePresentation,
    t,
  } = options;

  const { preserveDraft = false } = options;
  let dispatchStarted = false;
  let accepted = false;
  const sentPrompt = trimmed;
  const sentAttachments = [...pendingAttachments];
  const sentSkillIds = [...pendingSkillIds];
  const requestId = createConversationRequestId();
  const owningSessionId = currentSession?.sessionId ?? null;
  const isOwningSelectionActive = (sessionId: string | null) => {
    const selection = useProjectStore.getState();
    return selection.currentSessionId
      ? selection.currentSessionId === sessionId
      : (selection.currentProject?.projectId ?? null) === (currentProject?.projectId ?? null);
  };
  let turnOwnership = {
    sessionId: owningSessionId ?? 'no-session',
    requestId,
    agentId: selectedAgentId,
  };
  const claimedPlan = options.planReference;
  const referencedPlan = claimedPlan ? findPlanReview(selectOrderedConversationMessages(useConversationStore.getState()),
    { planId: claimedPlan.planId, revision: claimedPlan.revision, hash: claimedPlan.expectedHash }) : undefined;
  const optimistic = buildOptimisticConversationTurn({
    requestId,
    trimmed: sentPrompt,
    currentProject,
    currentSession,
    currentRun,
    pendingAttachments: sentAttachments,
    selectedAgentId,
    ...(claimedPlan && referencedPlan ? { planReference: {
      intent: claimedPlan.intent, planId: claimedPlan.planId, revision: claimedPlan.revision, hash: claimedPlan.expectedHash,
      uri: referencedPlan.uri, title: referencedPlan.title, agentId: selectedAgentId,
    } } : {}),
  });

  // A refused request takes its messages back out; an accepted one keeps them, since main's carry the same ids.
  const rollbackOptimistic = () => {
    setConversationMessages(removeRequestMessages(useConversationStore.getState().allConversationMessages, requestId));
  };

  useComposerSessionContextStore.getState().beginTurn({
    ...turnOwnership,
    projectId: currentProject?.projectId ?? null,
  });
  if (!preserveDraft) {
    setPromptValue('');
    setPendingAttachments([]);
    setPendingSkillIds([]);
  }
  useSessionStore.getState().setPreparedTurnContext(null);
  useSessionStore.getState().setConversationPreparationPhase('preparing');
  upsertConversationMessages([optimistic.userMessage, optimistic.assistantDraftMessage]);

  const restoreComposerDraft = () => {
    if (preserveDraft) return;
    const activeSessionId = useProjectStore.getState().currentSessionId;
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

  try {
    // A handoff runs on the session's committed Agent, model and controls (main wrote them with the handoff or the
    // approval), so only a person's own send freezes the Composer's configuration for main to check.
    const configuration = preserveDraft ? null : await buildConversationConfigurationCommit({
      selectedAgentId,
      currentProjectId: currentProject?.projectId,
      getEffectiveCatalog: (providerId) => electronAPI.settings.getEffectiveCatalog(providerId),
      modelOverride: readComposerEffectiveModel(
        selectedAgentId,
        currentSession,
        currentProject?.projectId,
      ),
    });
    const profileId = resolveComposerProfileId(selectedAgentId);
    const turnControls = { ...useTurnControlsStore.getState().turnControls };
    dispatchStarted = true;
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
      ...(options.planReference ? { planReference: options.planReference } : {}),
      turnControls,
      ...(configuration ? { configurationCommit: configuration.configurationCommit } : {}),
    });

    if (finishRevokedOrCancelled()) {
      return { status: 'cancelled', requestId };
    }

    if (result.status === 'rejected') {
      if (result.error.code === 'REQUEST_CANCELLED') {
        rollbackOptimistic();
        restoreComposerDraft();
        useComposerSessionContextStore.getState().clearActiveTurnIfOwned(turnOwnership);
        useSessionStore.getState().setPreparedTurnContext(null);
        useSessionStore.getState().setConversationPreparationPhase('idle');
        return { status: 'cancelled', requestId };
      }
      rollbackOptimistic();
      restoreComposerDraft();
      useComposerSessionContextStore.getState().clearActiveTurnIfOwned(turnOwnership);
      useSessionStore.getState().setPreparedTurnContext(null);
      useSessionStore.getState().setConversationPreparationPhase('idle');
      // The message is technical; the code words the toast and both leave through "Copy details".
      const failure = `${result.error.code}: ${result.error.message}`;
      if (!preserveDraft) notify.failure(failure, t, 'app.conversationRequestFailed');
      return { status: 'rejected', requestId, error: failure };
    }

    accepted = true;
    const stagedIds = sentAttachments
      .map((attachment) => attachment.stagingId)
      .filter((stagingId): stagingId is string => Boolean(stagingId));
    if (stagedIds.length > 0) {
      void electronAPI.conversation.releaseAttachments({ stagingIds: stagedIds });
    }

    const turn = result.turn;
    const committedSessionId = turn.session?.record.sessionId
      ?? turn.userMessage.sessionId
      ?? turn.assistantDraftMessage.sessionId
      ?? turnOwnership.sessionId;
    useComposerSessionContextStore.getState().bindCommittedSession(turnOwnership, committedSessionId);
    turnOwnership = { ...turnOwnership, sessionId: committedSessionId };
    if (isOwningSelectionActive(committedSessionId)) {
      useSessionStore.getState().setPreparedTurnContext(result.preparedContext);
      useSessionStore.getState().setConversationPreparationPhase('current');
    }

    await applyConversationTurnResult({
      electronAPI,
      result: turn,
      currentProject,
      setSessions,
      setCurrentRun,
      setRuns,
      setTracePresentation,
      setConversationMessages,
      setBranchState,
      setConversationSnapshot,
      upsertConversationMessages,
    });
    if (!preserveDraft) await persistComposerDraftToSession(
      turn.session?.record.sessionId ?? committedSessionId,
      currentProject?.projectId,
    );

    useComposerSessionContextStore.getState().clearActiveTurnIfOwned(turnOwnership);
    return { status: 'accepted', requestId };
  } catch (error) {
    if (finishRevokedOrCancelled()) {
      return { status: 'cancelled', requestId };
    }
    rollbackOptimistic();
    restoreComposerDraft();
    useComposerSessionContextStore.getState().clearActiveTurnIfOwned(turnOwnership);
    useSessionStore.getState().setPreparedTurnContext(null);
    useSessionStore.getState().setConversationPreparationPhase('idle');
    if (errorCodeOf(error) === 'REQUEST_CANCELLED') return { status: 'cancelled', requestId };
    if (!preserveDraft) notify.failure(error, t, 'app.conversationRequestFailed');
    if (accepted) return { status: 'accepted', requestId };
    if (preserveDraft && dispatchStarted && owningSessionId) return inspectHandoffCommit(electronAPI.conversation, owningSessionId, requestId);
    return { status: 'rejected', requestId, error: errorDetail(error) };
  }
}
