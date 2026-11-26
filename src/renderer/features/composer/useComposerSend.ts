import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { getCurrentSessionView } from '../../stores/sessionRecordStore';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { conversationWriters, sendComposerConversationTurn } from './composerSendFlow';
import { useComposerStop } from './useComposerStop';
import { executeSlashCommand } from './slashCommandExecutor';
import { isConcurrentModelSwitchCommand, shouldClearSubmittedPrompt } from './composerCommandConcurrency';
import { shouldSendComposerOnEnter } from './composerKeyboard';
import { inspectHandoffRequest, type HandoffSendPayload } from './composerHandoffSend';
import type { PendingAttachmentDraft } from '../../types/attachments';
import type { useI18n } from '../../i18n';
import type { ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
type Translate = ReturnType<typeof useI18n>['t'];

interface ComposerSendOptions {
  t: Translate;
  selectedAgentId: string;
  setSelectedAgentId: (agentId: string) => void;
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
  armPendingSkill: (skillId: string, skillName?: string) => void;
}

export function useComposerSend(options: ComposerSendOptions) {
  const { t, currentSession, currentRun, setPromptValue, setPendingAttachments, setPendingSkillIds } = options;
  const isPromptSending = useComposerSessionContextStore((state) => state.isPromptSending);
  const handoffPending = useComposerSessionContextStore((state) => !!state.handoffSuggestionRequest);
  const setIsPromptSending = useComposerSessionContextStore((state) => state.setIsPromptSending);
  const { handlePrimaryStop, stopPending } = useComposerStop({
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

  const isComposerBusy = isPromptSending || options.hasActiveConversationTurn || options.hasActiveDebugRun;
  // A send reads the Composer as it is when it starts; the prompt is read again once a command has run.
  const latest = useRef({ options, isComposerBusy });
  latest.current = { options, isComposerBusy };
  const sendingRef = useRef(false);
  const performSend = useCallback(
    async (handoff?: HandoffSendPayload) => {
      const { options: composer, isComposerBusy: busy } = latest.current;
      const { currentProject, currentSession: shown, selectedAgentId } = composer;
      const session = handoff ? getCurrentSessionView() : shown;
      if (handoff && session?.sessionId !== handoff.sessionId) return { status: 'cancelled' as const, requestId: '' };
      const trimmed = (handoff?.prompt ?? composer.promptValue).trim();
      const sentAttachments = handoff ? [] : composer.pendingAttachments;
      const sentSkills = handoff ? [] : composer.pendingSkillIds;
      const concurrentModelSwitch = isConcurrentModelSwitchCommand(trimmed);
      if ((!trimmed && !sentAttachments.some((attachment) => !attachment.error)) || (busy && !concurrentModelSwitch)) {
        return;
      }

      const electronAPI = window.electronAPI;
      const writers = conversationWriters();
      // A model switch runs beside a turn in flight; every other command holds the Composer while it runs.
      if (!handoff && trimmed.startsWith('/')) {
        if (!concurrentModelSwitch) setIsPromptSending(true);
        await executeSlashCommand(trimmed, {
          currentSession: shown,
          currentProject,
          selectedAgentId,
          setSelectedAgentId: composer.setSelectedAgentId,
          openSettings: composer.openSettings,
          armPendingSkill: composer.armPendingSkill,
          setConversationMessages: writers.setConversationMessages,
          upsertConversationMessages: writers.upsertConversationMessages,
        }).finally(() => {
          if (!concurrentModelSwitch) setIsPromptSending(false);
        });
        if (shouldClearSubmittedPrompt(latest.current.options.promptValue, trimmed)) composer.setPromptValue('');
        return;
      }

      if (sendingRef.current) return;
      sendingRef.current = true;
      setIsPromptSending(true);
      useComposerSessionContextStore.getState().setLastSent({
        sessionId: shown?.sessionId ?? 'no-session',
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
          currentProject,
          currentSession: session,
          currentRun: composer.currentRun,
          selectedAgentId: handoff?.agentId ?? selectedAgentId,
          selectedDeviceEntry: composer.selectedDeviceEntry,
          setPromptValue: composer.setPromptValue,
          setPendingAttachments: composer.setPendingAttachments,
          setPendingSkillIds: composer.setPendingSkillIds,
          ...writers,
          t: composer.t,
          preserveDraft: Boolean(handoff),
          planReference: handoff?.planReference,
        });
      } finally {
        sendingRef.current = false;
        setIsPromptSending(false);
      }
    },
    [setIsPromptSending],
  );
  const handlePromptSend = useCallback(async () => {
    await performSend();
  }, [performSend]);
  const sendHandoffPrompt = useCallback((payload: HandoffSendPayload) => performSend(payload), [performSend]);

  const handlePromptKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (shouldSendComposerOnEnter(event)) {
        event.preventDefault();
        void handlePromptSend();
      }
    },
    [handlePromptSend],
  );

  return {
    isPromptSending,
    isComposerBusy: isComposerBusy || handoffPending,
    stopPending,
    handlePrimaryStop,
    handlePromptSend,
    sendHandoffPrompt,
    inspectHandoff: inspectHandoffRequest,
    handlePromptKeyDown,
  };
}
