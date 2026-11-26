import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { conversationTurnIds } from '@shared/conversation/conversationTurnIds';
import { useSessionStore } from '../../stores/sessionStore';
import { useConversationStore } from '../../stores/conversationStore';
import { removeRequestMessages } from '../../stores/conversationSendHelpers';
import {
  restoreLastSentIfCurrentSession,
  type ActiveTurnOwnership,
  useComposerSessionContextStore,
} from '../../stores/composerSessionContextStore';
import { stopWorkTrace } from '../../lib/stopWorkTrace';
import { notify } from '../../stores/notificationStore';
import { selectActiveAssistantForTurn } from './composerStopSelection';
import { reconcileConversationStop } from './composerStopReconciliation';
import type { useI18n } from '../../i18n';
import type { PendingAttachmentDraft } from '../../types/attachments';
import type { RunSummary, SessionRecord } from '@shared/types/session';

export { stopWorkTrace };

type Translate = ReturnType<typeof useI18n>['t'];

/** The Stop notice never waits on the workflow stop, so its failure is only reported. */
const reportWorkflowStopFailure = (error: unknown) => console.warn('[composer] the workflow did not stop', error);

export function useComposerStop(options: {
  t: Translate;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
  setPromptValue?: (value: string) => void;
  setPendingAttachments?: Dispatch<SetStateAction<PendingAttachmentDraft[]>>;
  setPendingSkillIds?: Dispatch<SetStateAction<string[]>>;
}) {
  const { t, currentSession, currentRun, setPromptValue, setPendingAttachments, setPendingSkillIds } = options;
  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  // The session whose Stop main has not answered yet: its button shows the pending icon from the click on.
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null);
  const stopScope = currentSession?.sessionId ?? 'no-session';

  const handlePrimaryStop = useCallback(async () => {
    useComposerSessionContextStore.getState().clearHandoffSuggestion();
    const electronAPI = window.electronAPI;
    setStoppingSessionId(stopScope);
    try {
      useComposerSessionContextStore.getState().setIsPromptSending(false);
      const activeTurn = useComposerSessionContextStore.getState().activeTurn;
      const turnOwnership: ActiveTurnOwnership | null =
        activeTurn && activeTurn.sessionId === (currentSession?.sessionId ?? 'no-session')
          ? {
              sessionId: activeTurn.sessionId,
              requestId: activeTurn.requestId,
              agentId: activeTurn.agentId,
            }
          : null;
      const requestId = turnOwnership?.requestId ?? null;
      const conversation = useConversationStore.getState();
      const activeAssistant = selectActiveAssistantForTurn(
        conversation.conversationMessages,
        currentSession?.sessionId,
        activeTurn,
      );

      // Stop shows at once, whether the turn is still preparing or already streaming: the turn id is the same one
      // main gives it (conversationTurnIds), so the marks hold for main's messages too.
      const turnId = activeAssistant?.turnId ?? (requestId ? conversationTurnIds(requestId).turnId : null);
      if (requestId) conversation.markRequestMonotonicallyStopped(requestId);
      if (activeAssistant?.requestId) conversation.markRequestMonotonicallyStopped(activeAssistant.requestId);
      if (turnId) conversation.markTurnMonotonicallyStopped(turnId);
      if (activeAssistant) conversation.updateAssistantMessageByTurnId(activeAssistant.turnId, stopWorkTrace);

      const cancelPromise = electronAPI.conversation.cancelActiveTurn({
        requestId: requestId ?? undefined,
        sessionId: currentSession?.sessionId,
        turnId: turnId ?? undefined,
      });

      const workflowStopPromise =
        currentRun &&
        ['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running'].includes(currentRun.status)
          ? (setCurrentRun({ ...currentRun, status: 'stopping' }), electronAPI.workflow.stop(currentRun.runId))
          : null;

      const cancelResult = await cancelPromise;

      if (cancelResult.success && cancelResult.phase === 'preparing') {
        const revokedRequestId = requestId ?? cancelResult.cancelledRequestId ?? activeAssistant?.requestId ?? null;
        if (revokedRequestId) {
          conversation.markRequestRevoked(revokedRequestId);
          useConversationStore
            .getState()
            .setConversationMessages(
              removeRequestMessages(useConversationStore.getState().allConversationMessages, revokedRequestId),
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
          void workflowStopPromise.catch(reportWorkflowStopFailure);
        }
        notify.info(t('app.stopRunSent'));
        return;
      }

      await reconcileConversationStop({
        conversationAPI: electronAPI.conversation,
        cancelResult,
        sessionId: currentSession?.sessionId,
        activeAssistant,
        activeTurn,
        turnOwnership,
      });

      // Do not block notice on workflow stop latency.
      if (workflowStopPromise) {
        void workflowStopPromise.catch(reportWorkflowStopFailure);
      }

      if (!cancelResult.success) {
        const error = cancelResult.error;
        if (error && !error.includes('No active conversation')) {
          notify.failure(error, t, 'app.stopRunFailed');
          return;
        }
      }
      notify.info(t('app.stopRunSent'));
    } catch (error) {
      notify.failure(error, t, 'app.stopRunFailed');
    } finally {
      setStoppingSessionId((current) => (current === stopScope ? null : current));
    }
  }, [
    stopScope,
    currentRun,
    currentSession?.sessionId,
    setCurrentRun,
    setPendingAttachments,
    setPendingSkillIds,
    setPromptValue,
    t,
  ]);

  return { handlePrimaryStop, stopPending: stoppingSessionId === stopScope };
}
