import type { AgentMode } from '@shared/types/layout';
import type { ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { useSessionStore } from '../../../stores/sessionStore';
import {
  applyConversationTurnResult,
  syncE2EConversationState,
  toConversationMode,
  toConversationAttachmentInputs,
} from './composerSendHelpers';
import { useTurnControlsStore } from './useTurnControls';

export function createConversationRequestId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `request-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

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
  setActiveRequestId: (requestId: string | null) => void;
  showNotice: (message: string) => void;
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
    setActiveRequestId,
    showNotice,
    failedSummary,
  } = options;

  const sentPrompt = trimmed;
  const sentAttachments = [...pendingAttachments];
  const requestId = createConversationRequestId();
  setActiveRequestId(requestId);
  setPromptValue('');
  setPendingAttachments([]);
  useSessionStore.getState().setPreparedTurnContext(null);
  useSessionStore.getState().setConversationPreparationPhase('preparing');

  try {
    const agentCommit = await useAppSettingsStore.getState().flushAgentDefinitionSaves(selectedAgentId);
    const providerId = agentCommit?.route?.providerId;
    const providerCommit = providerId
      ? await useAppSettingsStore.getState().flushProviderSaves(providerId)
      : null;
    const effectiveCatalog = providerId
      ? await electronAPI.settings.getEffectiveCatalog(providerId)
      : null;
    const selectedModel = effectiveCatalog?.models.find((model) => model.modelId === agentCommit?.route?.modelId);
    const conversationMode = toConversationMode(currentMode);
    const turnControls = { ...useTurnControlsStore.getState().turnControls };
    const result = await electronAPI.conversation.sendMessage({
      requestId,
      projectId: currentProject?.projectId ?? null,
      sessionId: currentSession?.sessionId ?? null,
      currentRunId: currentRun?.runId ?? null,
      replayDeviceId: selectedDeviceEntry?.id ?? null,
      mode: conversationMode,
      agentId: selectedAgentId || null,
      message: sentPrompt,
      attachments: toConversationAttachmentInputs(sentAttachments),
      turnControls,
      configurationCommit: {
        agentId: selectedAgentId,
        agentCommitHash: agentCommit?.commitHash,
        providerId,
        providerCommitHash: providerCommit?.commitHash,
        providerCatalogRevision: effectiveCatalog?.catalogRevision ?? providerCommit?.catalogRevision ?? undefined,
        routeRevision: selectedModel?.routeRevision,
      },
    });

    if (result.status === 'rejected') {
      setPromptValue(sentPrompt);
      setPendingAttachments(sentAttachments);
      setActiveRequestId(null);
      useSessionStore.getState().setPreparedTurnContext(null);
      useSessionStore.getState().setConversationPreparationPhase('idle');
      showNotice(result.error.message || failedSummary);
      return;
    }

    const turn = result.turn;
    useSessionStore.getState().setPreparedTurnContext(result.preparedContext);
    useSessionStore.getState().setConversationPreparationPhase('current');

    await applyConversationTurnResult({
      electronAPI,
      result: turn,
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
      sessionId: turn.session?.sessionId ?? currentSession?.sessionId ?? null,
      turnId: turn.userMessage.turnId,
      setConversationMessages,
      setTracePresentation,
      setBranchState,
    });
  } catch (error) {
    setPromptValue(sentPrompt);
    setPendingAttachments(sentAttachments);
    setActiveRequestId(null);
    useSessionStore.getState().setPreparedTurnContext(null);
    useSessionStore.getState().setConversationPreparationPhase('idle');
    showNotice(error instanceof Error ? error.message : failedSummary);
  }
}
