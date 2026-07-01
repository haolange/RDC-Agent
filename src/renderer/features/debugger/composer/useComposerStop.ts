import { useCallback } from 'react';
import type { ConversationMessage } from '@shared/types/conversation';
import type { RunSummary, SessionRecord } from '@shared/types/session';
import { useSessionStore } from '../../../stores/sessionStore';
import { useConversationStore } from '../../../stores/conversationStore';
import type { useI18n } from '../../../i18n';

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
      blocks: message.workTrace.blocks.map((block) => (
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
}) {
  const { showNotice, t, currentSession, currentRun, setIsPromptSending } = options;
  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const conversationMessages = useConversationStore((state) => state.conversationMessages);
  const updateAssistantMessageByTurnId = useConversationStore((state) => state.updateAssistantMessageByTurnId);

  const handlePrimaryStop = useCallback(async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    try {
      setIsPromptSending(false);
      const activeAssistant = conversationMessages
        .slice()
        .reverse()
        .find((message) => (
          message.role === 'assistant'
          && ACTIVE_ASSISTANT_STATUSES.has(message.status)
          && (!currentSession?.sessionId || message.sessionId === currentSession.sessionId)
        ));
      if (activeAssistant) {
        updateAssistantMessageByTurnId(activeAssistant.turnId, stopWorkTrace);
      }

      const stopPromises: Array<Promise<{ success: boolean; error?: string }>> = [
        electronAPI.conversation.cancelActiveTurn({
          sessionId: currentSession?.sessionId,
        }),
      ];

      if (currentRun && ['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running'].includes(currentRun.status)) {
        setCurrentRun({
          ...currentRun,
          status: 'stopping',
        });
        stopPromises.push(electronAPI.workflow.stop(currentRun.runId));
      }

      const results = await Promise.allSettled(stopPromises);
      const failures = results
        .map((result) => (result.status === 'fulfilled' ? result.value : { success: false, error: String(result.reason) }))
        .filter((result) => !result.success);
      if (failures.length > 0 && failures.some((failure) => failure.error && !failure.error.includes('No active conversation'))) {
        showNotice(failures.find((failure) => failure.error)?.error ?? t('app.stopRunFailed'));
        return;
      }
      showNotice(t('app.stopRunSent'));
    } catch (error) {
      setIsPromptSending(false);
      showNotice(error instanceof Error ? error.message : t('app.stopRunFailed'));
    }
  }, [conversationMessages, currentRun, currentSession?.sessionId, setCurrentRun, setIsPromptSending, showNotice, t, updateAssistantMessageByTurnId]);

  return { handlePrimaryStop };
}
