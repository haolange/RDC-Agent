import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { AgentMode } from '@shared/types/layout';
import type { ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import { useConversationStore } from '../../../stores/conversationStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import type { useI18n } from '../../../i18n';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';
import {
  applyConversationTurnResult,
  buildLocalConversationErrorTurn,
  syncE2EConversationState,
  toConversationAttachmentInputs,
} from './composerSendHelpers';
import { useComposerStop } from './useComposerStop';

type Translate = ReturnType<typeof useI18n>['t'];

export function useComposerSend(options: {
  showNotice: (message: string) => void;
  t: Translate;
  currentMode: AgentMode;
  setCurrentMode: (mode: AgentMode) => void;
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
  selectedDeviceEntry: { id: string } | undefined;
  hasOpenedCaptureForCurrentProject: boolean;
  openCaptureRequiredLabel: string;
  hasActiveDebugRun: boolean;
  hasActiveConversationTurn: boolean;
  promptValue: string;
  setPromptValue: (value: string) => void;
  pendingAttachments: PendingAttachmentDraft[];
  setPendingAttachments: Dispatch<SetStateAction<PendingAttachmentDraft[]>>;
}) {
  const {
    showNotice,
    t,
    currentMode,
    currentProject,
    currentSession,
    currentRun,
    selectedDeviceEntry,
    hasActiveDebugRun,
    hasActiveConversationTurn,
    promptValue,
    setPromptValue,
    pendingAttachments,
    setPendingAttachments,
  } = options;

  const [isPromptSending, setIsPromptSending] = useState(false);

  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setSessions = useProjectStore((state) => state.setSessions);
  const setCurrentSession = useProjectStore((state) => state.setCurrentSession);
  const setRuns = useSessionStore((state) => state.setRuns);
  const setCurrentDebugPlan = useWorkflowStore((state) => state.setCurrentDebugPlan);
  const setPendingQuestions = useWorkflowStore((state) => state.setPendingQuestions);
  const setTracePresentation = useWorkflowStore((state) => state.setTracePresentation);
  const setConversationMessages = useConversationStore((state) => state.setConversationMessages);
  const upsertConversationMessages = useConversationStore((state) => state.upsertConversationMessages);

  const { handlePrimaryStop } = useComposerStop({
    showNotice,
    t,
    currentSession,
    currentRun,
    setIsPromptSending,
  });

  const isComposerBusy = isPromptSending || hasActiveConversationTurn || hasActiveDebugRun;

  const handlePromptSend = useCallback(async () => {
    const trimmed = promptValue.trim();
    if ((!trimmed && pendingAttachments.length === 0) || isComposerBusy) {
      return;
    }

    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    setIsPromptSending(true);
    try {
      const result = await electronAPI.conversation.sendMessage({
        projectId: currentProject?.projectId ?? null,
        sessionId: currentSession?.sessionId ?? null,
        currentRunId: currentRun?.runId ?? null,
        replayDeviceId: selectedDeviceEntry?.id ?? null,
        mode: currentMode,
        message: trimmed,
        attachments: toConversationAttachmentInputs(pendingAttachments),
      });

      setPromptValue('');
      setPendingAttachments([]);

      await applyConversationTurnResult({
        electronAPI,
        result,
        currentProject,
        setCurrentSession,
        setSessions,
        setCurrentRun,
        setRuns,
        setCurrentDebugPlan,
        setPendingQuestions,
        setTracePresentation,
        upsertConversationMessages,
      });

      await syncE2EConversationState({
        electronAPI,
        sessionId: result.session?.sessionId ?? currentSession?.sessionId ?? null,
        turnId: result.userMessage.turnId,
        setConversationMessages,
        setTracePresentation,
      });
    } catch (error) {
      const currentMessages = useConversationStore.getState().conversationMessages ?? [];
      const failedSummary = t('app.conversationRequestFailed');
      setConversationMessages(currentMessages.concat(buildLocalConversationErrorTurn({
        trimmed,
        currentMode,
        currentProject,
        currentSession,
        currentRun,
        pendingAttachments,
        errorMessage: error instanceof Error ? error.message : failedSummary,
        failedSummary,
      })));
    } finally {
      setIsPromptSending(false);
    }
  }, [
    currentProject,
    currentMode,
    currentRun,
    currentSession,
    hasActiveConversationTurn,
    hasActiveDebugRun,
    isComposerBusy,
    pendingAttachments,
    promptValue,
    selectedDeviceEntry,
    setConversationMessages,
    setCurrentDebugPlan,
    setCurrentRun,
    setCurrentSession,
    setPendingAttachments,
    setPendingQuestions,
    setPromptValue,
    setTracePresentation,
    setRuns,
    setSessions,
    showNotice,
    t,
    upsertConversationMessages,
  ]);

  const handlePromptKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handlePromptSend();
    }
  }, [handlePromptSend]);

  return {
    isPromptSending,
    isComposerBusy,
    handlePrimaryStop,
    handlePromptSend,
    handlePromptKeyDown,
  };
}
