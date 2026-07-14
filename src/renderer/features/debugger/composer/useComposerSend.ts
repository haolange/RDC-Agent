import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AgentMode } from '@shared/types/layout';
import type { ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import { useConversationStore } from '../../../stores/conversationStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import type { useI18n } from '../../../i18n';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';
import { sendComposerConversationTurn } from './composerSendFlow';
import { useComposerStop } from './useComposerStop';
import { executeSlashCommand } from './slashCommandExecutor';
import {
  isConcurrentModelSwitchCommand,
  shouldClearSubmittedPrompt,
} from './composerCommandConcurrency';

type Translate = ReturnType<typeof useI18n>['t'];

export function useComposerSend(options: {
  showNotice: (message: string) => void;
  t: Translate;
  currentMode: AgentMode;
  selectedAgentId: string;
  setSelectedAgentId: (agentId: string) => void;
  setCurrentMode: (mode: AgentMode) => void;
  openSettings: (section?: string) => void;
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
  selectedDeviceEntry: { id: string } | undefined;
  hasOpenedCaptureForCurrentProject: boolean;
  hasActiveDebugRun: boolean;
  hasActiveConversationTurn: boolean;
  promptValue: string;
  setPromptValue: (value: string) => void;
  pendingAttachments: PendingAttachmentDraft[];
  setPendingAttachments: Dispatch<SetStateAction<PendingAttachmentDraft[]>>;
}) {
  const {
    showNotice, t, currentMode, selectedAgentId, setSelectedAgentId, setCurrentMode, openSettings, currentProject,
    currentSession, currentRun, selectedDeviceEntry,
    hasActiveDebugRun, hasActiveConversationTurn, promptValue,
    setPromptValue, pendingAttachments, setPendingAttachments,
  } = options;
  const [isPromptSending, setIsPromptSending] = useState(false);
  const promptValueRef = useRef(promptValue);
  promptValueRef.current = promptValue;

  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setSessions = useProjectStore((state) => state.setSessions);
  const setCurrentSession = useProjectStore((state) => state.setCurrentSession);
  const setRuns = useSessionStore((state) => state.setRuns);
  const setTracePresentation = useWorkflowStore((state) => state.setTracePresentation);
  const setConversationMessages = useConversationStore((state) => state.setConversationMessages);
  const setBranchState = useConversationStore((state) => state.setBranchState);
  const setConversationSnapshot = useConversationStore((state) => state.setConversationSnapshot);
  const upsertConversationMessages = useConversationStore((state) => state.upsertConversationMessages);

  const { handlePrimaryStop } = useComposerStop({ showNotice, t, currentSession, currentRun, setIsPromptSending });

  const isComposerBusy = isPromptSending || hasActiveConversationTurn || hasActiveDebugRun;

  const handlePromptSend = useCallback(async () => {
    const trimmed = promptValue.trim();
    const concurrentModelSwitch = isConcurrentModelSwitchCommand(trimmed);
    if ((!trimmed && pendingAttachments.length === 0) || (isComposerBusy && !concurrentModelSwitch)) {
      return;
    }

    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    // === 斜杠命令拦截 ===
    if (trimmed.startsWith('/')) {
      if (!concurrentModelSwitch) setIsPromptSending(true);
      try {
        const handled = await executeSlashCommand(trimmed, {
          currentSession,
          currentProject,
          selectedAgentId,
          setSelectedAgentId,
          setCurrentMode,
          setConversationMessages,
          upsertConversationMessages,
          openSettings,
          showNotice,
        });
        if (handled) {
          if (shouldClearSubmittedPrompt(promptValueRef.current, trimmed)) setPromptValue('');
          return;
        }
      } finally {
        if (!concurrentModelSwitch) setIsPromptSending(false);
      }
    }

    setIsPromptSending(true);
    try {
      await sendComposerConversationTurn({
        electronAPI,
        trimmed,
        pendingAttachments,
        currentMode,
        currentProject,
        currentSession,
        currentRun,
        selectedAgentId,
        selectedDeviceEntry,
        setPromptValue,
        setPendingAttachments,
        setConversationMessages,
        setBranchState,
        setConversationSnapshot,
        upsertConversationMessages,
        setCurrentSession,
        setSessions,
        setCurrentRun,
        setRuns,
        setTracePresentation,
        failedSummary: t('app.conversationRequestFailed'),
      });
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
    selectedAgentId,
    setSelectedAgentId,
    setCurrentMode,
    openSettings,
    setConversationMessages, setBranchState, setConversationSnapshot,
    setCurrentRun, setCurrentSession,
    setPendingAttachments,
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
