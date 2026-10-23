import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { RunSummary, SessionRecord } from '@shared/types/session';
import type { PendingAttachmentDraft } from '../../types/attachments';
import { useSessionStore } from '../../stores/sessionStore';
import { useConversationStore } from '../../stores/conversationStore';
import type { useI18n } from '../../i18n';
import { removeOptimisticConversationMessages } from '../../stores/conversationSendHelpers';
import {
  restoreLastSentIfCurrentSession,
  type ActiveTurnOwnership,
  useComposerSessionContextStore,
} from '../../stores/composerSessionContextStore';
import { stopWorkTrace } from '../../lib/stopWorkTrace';
import { selectActiveAssistantForTurn } from './composerStopSelection';
import { reconcileConversationStop } from './composerStopReconciliation';

export { stopWorkTrace };

type Translate = ReturnType<typeof useI18n>['t'];

export function useComposerStop(options: {
  showNotice: (message: string) => void;
  t: Translate;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
  setPromptValue?: (value: string) => void;
  setPendingAttachments?: Dispatch<SetStateAction<PendingAttachmentDraft[]>>;
  setPendingSkillIds?: Dispatch<SetStateAction<string[]>>;
}) {
  const {
    showNotice,
    t,
    currentSession,
    currentRun,
    setPromptValue,
    setPendingAttachments,
    setPendingSkillIds,
  } = options;
  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);

  const handlePrimaryStop = useCallback(async () => {
    useComposerSessionContextStore.getState().clearHandoffSuggestion();
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    try {
      useComposerSessionContextStore.getState().setIsPromptSending(false);
      const activeTurn = useComposerSessionContextStore.getState().activeTurn;
      const turnOwnership: ActiveTurnOwnership | null = (
        activeTurn
        && activeTurn.sessionId === (currentSession?.sessionId ?? 'no-session')
          ? {
            sessionId: activeTurn.sessionId,
            requestId: activeTurn.requestId,
            agentId: activeTurn.agentId,
          }
          : null
      );
      const requestId = turnOwnership?.requestId ?? null;
      const conversation = useConversationStore.getState();
      const activeAssistant = selectActiveAssistantForTurn(
        conversation.conversationMessages,
        currentSession?.sessionId,
        activeTurn,
      );

      // Optimistic stop for both preparing (optimistic-turn-*) and committed streaming turns.
      if (activeAssistant) {
        if (requestId) conversation.markRequestMonotonicallyStopped(requestId);
        if (activeAssistant.requestId) {
          conversation.markRequestMonotonicallyStopped(activeAssistant.requestId);
        }
        conversation.markTurnMonotonicallyStopped(activeAssistant.turnId);
        if (activeTurn?.optimisticTurnId) {
          conversation.markTurnMonotonicallyStopped(activeTurn.optimisticTurnId);
        }
        conversation.updateAssistantMessageByTurnId(activeAssistant.turnId, stopWorkTrace);
      } else if (requestId) {
        conversation.markRequestMonotonicallyStopped(requestId);
        if (activeTurn?.optimisticTurnId) {
          conversation.markTurnMonotonicallyStopped(activeTurn.optimisticTurnId);
        }
      }

      const clearlyPastPreparing = Boolean(
        activeAssistant
        && !activeAssistant.turnId.startsWith('optimistic-turn-'),
      );

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

      if (cancelResult.success && cancelResult.phase === 'preparing') {
        const revokedRequestId = requestId
          ?? cancelResult.cancelledRequestId
          ?? activeAssistant?.requestId
          ?? null;
        if (revokedRequestId) {
          conversation.markRequestRevoked(revokedRequestId);
          const optimisticIds = conversation.allConversationMessages
            .filter((message) => message.requestId === revokedRequestId)
            .map((message) => message.id);
          useConversationStore.getState().setConversationMessages(
            removeOptimisticConversationMessages(
              useConversationStore.getState().allConversationMessages,
              optimisticIds,
            ),
          );
        }
        if (setPromptValue && setPendingAttachments && setPendingSkillIds) {
          restoreLastSentIfCurrentSession(currentSession?.sessionId, (lastSent) => {
            setPromptValue(lastSent.prompt);
            setPendingAttachments(lastSent.attachments);
            setPendingSkillIds(lastSent.skillIds);
          });
        }
        useSessionStore.getState().setPreparedTurnContext(null);
        useSessionStore.getState().setConversationPreparationPhase('idle');
        if (turnOwnership) {
          useComposerSessionContextStore.getState().clearActiveTurnIfOwned(turnOwnership);
        }
        if (workflowStopPromise) {
          void workflowStopPromise.catch(() => undefined);
        }
        showNotice(t('app.stopRunSent'));
        return;
      }

      await reconcileConversationStop({ conversationAPI: electronAPI.conversation, cancelResult,
        sessionId: currentSession?.sessionId, activeAssistant, activeTurn, turnOwnership });

      // Do not block notice on workflow stop latency.
      if (workflowStopPromise) {
        void workflowStopPromise.catch(() => undefined);
      }

      if (!cancelResult.success) {
        const error = cancelResult.error;
        if (error && !error.includes('No active conversation')) {
          showNotice(error);
          return;
        }
      }
      showNotice(t('app.stopRunSent'));
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('app.stopRunFailed'));
    }
  }, [
    currentRun,
    currentSession?.sessionId,
    setCurrentRun,
    setPendingAttachments,
    setPendingSkillIds,
    setPromptValue,
    showNotice,
    t,
  ]);

  return { handlePrimaryStop };
}
