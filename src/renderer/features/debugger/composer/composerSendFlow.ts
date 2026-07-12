import type { AgentMode } from '@shared/types/layout';
import type { ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';
import { useConversationStore } from '../../../stores/conversationStore';
import {
  applyConversationTurnResult,
  buildLocalConversationErrorTurn,
  buildOptimisticConversationTurn,
  removeOptimisticConversationMessages,
  syncE2EConversationState,
  toConversationMode,
  toConversationAttachmentInputs,
} from './composerSendHelpers';
import { useTurnControlsStore } from './useTurnControls';

export async function sendComposerConversationTurn(options: {
  electronAPI: NonNullable<Window['electronAPI']>;
  trimmed: string;
  pendingAttachments: PendingAttachmentDraft[];
  currentMode: AgentMode;
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
  selectedAgentId: string;
  selectedDeviceEntry: { id: string } | undefined;
  setPromptValue: (value: string) => void;
  setPendingAttachments: (value: PendingAttachmentDraft[]) => void;
  setConversationMessages: (messages: ConversationMessage[]) => void;
  setBranchState: (branchState: ConversationBranchState | null) => void;
  setConversationSnapshot?: (
    messages: ConversationMessage[],
    branchState?: ConversationBranchState | null,
  ) => void;
  upsertConversationMessages: (messages: ConversationMessage[]) => void;
  setCurrentSession: (session: SessionRecord | null) => void;
  setSessions: (sessions: SessionRecord[]) => void;
  setCurrentRun: (run: RunSummary | null) => void;
  setRuns: (runs: RunSummary[]) => void;
  setTracePresentation: (presentation: AgentRunPresentation | null) => void;
  failedSummary: string;
}): Promise<void> {
  const {
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
    failedSummary,
  } = options;

  const sentPrompt = trimmed;
  const sentAttachments = [...pendingAttachments];
  const optimistic = buildOptimisticConversationTurn({
    trimmed: sentPrompt,
    currentMode,
    currentProject,
    currentSession,
    currentRun,
    pendingAttachments: sentAttachments,
    selectedAgentId,
  });
  const messagesBeforeSend = useConversationStore.getState().conversationMessages ?? [];
  setPromptValue('');
  setPendingAttachments([]);
  upsertConversationMessages([optimistic.userMessage, optimistic.assistantDraftMessage]);

  try {
    const conversationMode = toConversationMode(currentMode);
    const turnControls = { ...useTurnControlsStore.getState().turnControls };
    const result = await electronAPI.conversation.sendMessage({
      projectId: currentProject?.projectId ?? null,
      sessionId: currentSession?.sessionId ?? null,
      currentRunId: currentRun?.runId ?? null,
      replayDeviceId: selectedDeviceEntry?.id ?? null,
      mode: conversationMode,
      agentId: selectedAgentId || null,
      message: sentPrompt,
      attachments: toConversationAttachmentInputs(sentAttachments),
      turnControls,
    });

    // Drop optimistic placeholders before applying authoritative turn messages.
    setConversationMessages(removeOptimisticConversationMessages(
      useConversationStore.getState().allConversationMessages ?? [],
      optimistic.optimisticIds,
    ));

    await applyConversationTurnResult({
      electronAPI,
      result,
      currentProject,
      setCurrentSession,
      setSessions,
      setCurrentRun,
      setRuns,
      setTracePresentation,
      setConversationMessages,
      setBranchState,
      setConversationSnapshot,
      upsertConversationMessages,
    });

    await syncE2EConversationState({
      electronAPI,
      sessionId: result.session?.sessionId ?? currentSession?.sessionId ?? null,
      turnId: result.userMessage.turnId,
      setConversationMessages,
      setTracePresentation,
      setBranchState,
    });
  } catch (error) {
    setConversationMessages(removeOptimisticConversationMessages(
      useConversationStore.getState().conversationMessages ?? messagesBeforeSend,
      optimistic.optimisticIds,
    ));
    setPromptValue(sentPrompt);
    setPendingAttachments(sentAttachments);
    const currentMessages = useConversationStore.getState().conversationMessages ?? [];
    setConversationMessages(currentMessages.concat(buildLocalConversationErrorTurn({
      trimmed: sentPrompt,
      currentMode,
      currentProject,
      currentSession,
      currentRun,
      pendingAttachments: sentAttachments,
      errorMessage: error instanceof Error ? error.message : failedSummary,
      failedSummary,
      selectedAgentId,
    })));
  }
}
