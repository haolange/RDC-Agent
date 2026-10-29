import { shouldSendComposerOnEnter } from './composerKeyboard';
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { AgentMode } from '@shared/types/layout';
import type { ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import { useConversationStore } from '../../stores/conversationStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { useI18n } from '../../i18n';
import type { PendingAttachmentDraft } from '../../types/attachments';
import { sendComposerConversationTurn } from './composerSendFlow';
import { useComposerStop } from './useComposerStop';
import { executeSlashCommand } from './slashCommandExecutor';
import {
  isConcurrentModelSwitchCommand,
  shouldClearSubmittedPrompt,
} from './composerCommandConcurrency';
import { inspectHandoffCommit, type HandoffSendPayload } from './composerHandoffSend';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
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
  hasActiveDebugRun: boolean;
  hasActiveConversationTurn: boolean;
  promptValue: string;
  setPromptValue: (value: string) => void;
  pendingAttachments: PendingAttachmentDraft[];
  setPendingAttachments: Dispatch<SetStateAction<PendingAttachmentDraft[]>>;
  pendingSkillIds: string[];
  setPendingSkillIds: Dispatch<SetStateAction<string[]>>;
  armPendingSkill: (skillId: string) => void;
}) {
  const {
    showNotice, t, currentMode, selectedAgentId, setSelectedAgentId, setCurrentMode, openSettings, currentProject,
    currentSession, currentRun, selectedDeviceEntry,
    hasActiveDebugRun, hasActiveConversationTurn, promptValue,
    setPromptValue, pendingAttachments, setPendingAttachments,
    pendingSkillIds, setPendingSkillIds, armPendingSkill,
  } = options;
  const isPromptSending = useComposerSessionContextStore((state) => state.isPromptSending);
  const handoffPending = useComposerSessionContextStore(state => !!state.handoffSuggestionRequest);
  const setIsPromptSending = useComposerSessionContextStore((state) => state.setIsPromptSending);
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

  const { handlePrimaryStop } = useComposerStop({
    showNotice,
    t,
    currentSession,
    currentRun,
    setPromptValue,
    setPendingAttachments,
    setPendingSkillIds,
  });

  useEffect(() => {
    // Session switch already clears via hygiene; keep local busy false if session cleared mid-send.
    if (!currentSession?.sessionId) {
      setIsPromptSending(false);
    }
  }, [currentSession?.sessionId, setIsPromptSending]);

  const isComposerBusy = isPromptSending || hasActiveConversationTurn || hasActiveDebugRun;
  const sendingRef = useRef(false);
  const performSend = useCallback(async (handoff?: HandoffSendPayload) => {
    const session = handoff ? useProjectStore.getState().currentSession : currentSession;
    if (handoff && session?.sessionId !== handoff.sessionId) return { status: 'cancelled' as const, requestId: '' };
    const trimmed = (handoff?.prompt ?? promptValue).trim();
    const sentAttachments = handoff ? [] : pendingAttachments;
    const sentSkills = handoff ? [] : pendingSkillIds;
    const concurrentModelSwitch = isConcurrentModelSwitchCommand(trimmed);
    if ((!trimmed && !sentAttachments.some((attachment) => !attachment.error))
      || (isComposerBusy && !concurrentModelSwitch)) {
      return;
    }

    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    if (!handoff && trimmed.startsWith('/')) {
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
          armPendingSkill,
        });
        if (handled) {
          if (shouldClearSubmittedPrompt(promptValueRef.current, trimmed)) setPromptValue('');
          return;
        }
      } finally {
        if (!concurrentModelSwitch) setIsPromptSending(false);
      }
    }

    if (sendingRef.current) return;
    sendingRef.current = true;
    setIsPromptSending(true);
    useComposerSessionContextStore.getState().setLastSent({
      sessionId: currentSession?.sessionId ?? 'no-session',
      projectId: currentProject?.projectId ?? null,
      prompt: trimmed,
      attachments: [...sentAttachments],
      skillIds: [...sentSkills],
      ...(handoff ? { preserveDraft: true } : {}),
    });
    try {
      return await sendComposerConversationTurn({
        electronAPI,
        trimmed,
        pendingAttachments: sentAttachments,
        pendingSkillIds: sentSkills,
        currentMode,
        currentProject,
        currentSession: session,
        currentRun,
        selectedAgentId: handoff?.agentId ?? selectedAgentId,
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
        failedSummary: t('app.conversationRequestFailed'),
        preserveDraft: Boolean(handoff),
      });
    } finally {
      sendingRef.current = false;
      setIsPromptSending(false);
    }
  }, [
    armPendingSkill, currentProject, currentMode, currentRun, currentSession, isComposerBusy,
    pendingAttachments, pendingSkillIds, promptValue, selectedDeviceEntry, selectedAgentId,
    setSelectedAgentId, setCurrentMode, openSettings, setConversationMessages, setBranchState,
    setConversationSnapshot, setCurrentRun, setCurrentSession, setIsPromptSending,
    setPendingAttachments, setPendingSkillIds, setPromptValue, setTracePresentation,
    setRuns, setSessions, showNotice, t, upsertConversationMessages,
  ]);

  const handlePromptSend = useCallback(async () => { await performSend(); }, [performSend]);
  const sendHandoffPrompt = useCallback((payload: HandoffSendPayload) => performSend(payload), [performSend]);
  const inspectHandoff = useCallback((sessionId: string, requestId: string) => {
    const api = window.electronAPI;
    return api ? inspectHandoffCommit(api.conversation, sessionId, requestId)
      : Promise.resolve({ status: 'unknown' as const, requestId, error: 'BRIDGE_UNAVAILABLE' });
  }, []);

  const handlePromptKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (shouldSendComposerOnEnter(event)) {
      event.preventDefault();
      void handlePromptSend();
    }
  }, [handlePromptSend]);

  return {
    isPromptSending,
    isComposerBusy: isComposerBusy || handoffPending,
    handlePrimaryStop,
    handlePromptSend,
    sendHandoffPrompt, inspectHandoff,
    handlePromptKeyDown,
  };
}
