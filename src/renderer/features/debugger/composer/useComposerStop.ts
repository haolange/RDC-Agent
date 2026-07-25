import { useCallback, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import type { ConversationMessage } from '@shared/types/conversation';
import type { RunSummary, SessionRecord } from '@shared/types/session';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';
import { useSessionStore } from '../../../stores/sessionStore';
import { useConversationStore } from '../../../stores/conversationStore';
import type { useI18n } from '../../../i18n';
import { removeOptimisticConversationMessages } from './composerSendHelpers';

type Translate = ReturnType<typeof useI18n>['t'];

const ACTIVE_ASSISTANT_STATUSES = new Set<ConversationMessage['status']>(['draft', 'streaming']);

export const stopWorkTrace = (message: ConversationMessage): ConversationMessage => {
  const stoppedAt = Date.now();
  if (!message.workTrace) {
    return {
      ...message,
      status: 'stopped',
      updatedAt: stoppedAt,
    };
  }

  return {
    ...message,
    status: 'stopped',
    updatedAt: stoppedAt,
    workTrace: {
      ...message.workTrace,
      status: 'stopped',
      summary: message.workTrace.summary || 'Request stopped.',
      updatedAt: stoppedAt,
      blocks: (message.workTrace.blocks ?? []).map((block) => (
        block.status === 'running'
          ? { ...block, status: 'complete', completedAt: stoppedAt }
          : block
      )),
    },
  };
};

export function useComposerStop(options: {
  showNotice: (message: string) => void;
  t: Translate;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
  setIsPromptSending: (sending: boolean) => void;
  activeRequestIdRef: MutableRefObject<string | null>;
  setPromptValue?: (value: string) => void;
  setPendingAttachments?: Dispatch<SetStateAction<PendingAttachmentDraft[]>>;
  setPendingSkillIds?: Dispatch<SetStateAction<string[]>>;
  lastSentPromptRef?: MutableRefObject<{
    prompt: string;
    attachments: PendingAttachmentDraft[];
    skillIds: string[];
  } | null>;
}) {
  const {
    showNotice,
    t,
    currentSession,
    currentRun,
    setIsPromptSending,
    activeRequestIdRef,
    setPromptValue,
    setPendingAttachments,
    setPendingSkillIds,
    lastSentPromptRef,
  } = options;
  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);

  const handlePrimaryStop = useCallback(async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    try {
      setIsPromptSending(false);
      const requestId = activeRequestIdRef.current;
      const conversation = useConversationStore.getState();
      const activeAssistant = conversation.conversationMessages
        .slice()
        .reverse()
        .find((message) => (
          message.role === 'assistant'
          && ACTIVE_ASSISTANT_STATUSES.has(message.status)
          && (!currentSession?.sessionId || message.sessionId === currentSession.sessionId)
        ));

      // Committed/streaming turns can stop optimistically; preparing waits on phase.
      const clearlyPastPreparing = Boolean(
        activeAssistant
        && !activeAssistant.turnId.startsWith('optimistic-turn-'),
      );
      if (clearlyPastPreparing && activeAssistant) {
        if (requestId) conversation.markRequestMonotonicallyStopped(requestId);
        conversation.markTurnMonotonicallyStopped(activeAssistant.turnId);
        conversation.updateAssistantMessageByTurnId(activeAssistant.turnId, stopWorkTrace);
      }

      // Phase from main is authoritative: preparing → revoke; committing/running → monotonic stop.
      const cancelPromise = electronAPI.conversation.cancelActiveTurn({
        requestId: requestId ?? undefined,
        sessionId: currentSession?.sessionId,
        turnId: clearlyPastPreparing ? activeAssistant?.turnId : undefined,
      });

      const workflowStopPromise = currentRun
        && ['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running'].includes(currentRun.status)
        ? (setCurrentRun({ ...currentRun, status: 'stopping' }), electronAPI.workflow.stop(currentRun.runId))
        : null;

      const cancelResult = await cancelPromise;

      if (cancelResult.success && cancelResult.phase === 'preparing' && requestId) {
        conversation.markRequestRevoked(requestId);
        const optimisticIds = conversation.allConversationMessages
          .filter((message) => message.requestId === requestId)
          .map((message) => message.id);
        useConversationStore.getState().setConversationMessages(
          removeOptimisticConversationMessages(
            useConversationStore.getState().allConversationMessages,
            optimisticIds,
          ),
        );
        const lastSent = lastSentPromptRef?.current;
        if (lastSent && setPromptValue && setPendingAttachments && setPendingSkillIds) {
          setPromptValue(lastSent.prompt);
          setPendingAttachments(lastSent.attachments);
          setPendingSkillIds(lastSent.skillIds);
        }
        useSessionStore.getState().setPreparedTurnContext(null);
        useSessionStore.getState().setConversationPreparationPhase('idle');
        activeRequestIdRef.current = null;
        if (workflowStopPromise) {
          await workflowStopPromise.catch(() => undefined);
        }
        showNotice(t('app.stopRunSent'));
        return;
      }

      const latestConversation = useConversationStore.getState();
      const latestActiveAssistant = latestConversation.conversationMessages
        .slice()
        .reverse()
        .find((message) => (
          message.role === 'assistant'
          && ACTIVE_ASSISTANT_STATUSES.has(message.status)
          && (!currentSession?.sessionId || message.sessionId === currentSession.sessionId)
        ))
        ?? (activeAssistant && ACTIVE_ASSISTANT_STATUSES.has(activeAssistant.status) ? activeAssistant : null);

      if (requestId) {
        latestConversation.markRequestMonotonicallyStopped(requestId);
      }
      if (latestActiveAssistant) {
        latestConversation.markTurnMonotonicallyStopped(latestActiveAssistant.turnId);
        latestConversation.updateAssistantMessageByTurnId(latestActiveAssistant.turnId, stopWorkTrace);
      } else if (cancelResult.cancelledTurnId) {
        latestConversation.markTurnMonotonicallyStopped(cancelResult.cancelledTurnId);
        latestConversation.updateAssistantMessageByTurnId(cancelResult.cancelledTurnId, stopWorkTrace);
      }

      if (cancelResult.success) {
        activeRequestIdRef.current = null;
      }

      const workflowResult = workflowStopPromise ? await workflowStopPromise : null;
      const failures = [
        cancelResult.success ? null : cancelResult,
        workflowResult && !workflowResult.success ? workflowResult : null,
      ].filter((entry): entry is { success: boolean; error?: string } => Boolean(entry));

      if (failures.length > 0 && failures.some((failure) => failure.error && !failure.error.includes('No active conversation'))) {
        showNotice(failures.find((failure) => failure.error)?.error ?? t('app.stopRunFailed'));
        return;
      }
      showNotice(t('app.stopRunSent'));
    } catch (error) {
      setIsPromptSending(false);
      showNotice(error instanceof Error ? error.message : t('app.stopRunFailed'));
    }
  }, [
    activeRequestIdRef,
    currentRun,
    currentSession?.sessionId,
    lastSentPromptRef,
    setCurrentRun,
    setIsPromptSending,
    setPendingAttachments,
    setPendingSkillIds,
    setPromptValue,
    showNotice,
    t,
  ]);

  return { handlePrimaryStop };
}
