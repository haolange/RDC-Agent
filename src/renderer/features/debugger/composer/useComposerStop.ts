import { useCallback } from 'react';
import type { RunSummary, SessionRecord } from '@shared/types/session';
import { useSessionStore } from '../../../stores/sessionStore';
import type { useI18n } from '../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

export function useComposerStop(options: {
  showNotice: (message: string) => void;
  t: Translate;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
  setIsPromptSending: (sending: boolean) => void;
}) {
  const { showNotice, t, currentSession, currentRun, setIsPromptSending } = options;
  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);

  const handlePrimaryStop = useCallback(async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    try {
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
      setIsPromptSending(false);
      if (failures.length > 0 && failures.some((failure) => failure.error && !failure.error.includes('No active conversation'))) {
        showNotice(failures.find((failure) => failure.error)?.error ?? t('app.stopRunFailed'));
        return;
      }
      showNotice(t('app.stopRunSent'));
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('app.stopRunFailed'));
    }
  }, [currentRun, currentSession?.sessionId, setCurrentRun, setIsPromptSending, showNotice, t]);

  return { handlePrimaryStop };
}
