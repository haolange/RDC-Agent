import { useCallback, useEffect, useRef } from 'react';
import { AGENT_MODES, resolveAgentDisplay } from '@shared/constants/agents';
import { useI18n } from '../../i18n';
import { useConversationStore } from '../../stores/conversationStore';
import { useProjectStore } from '../../stores/projectStore';
import { useCurrentSessionView } from '../../stores/sessionRecordStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useTurnControlsStore } from '../../stores/turnControlsStore';
import { usePreparedSessionDevice } from '../../hooks/useSessionDevicePreparation';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useComposerAgentId } from '../../hooks/useComposerAgentId';
import { agentArgumentHint } from '../../lib/agentDescription';
import { useComposerAttachments } from './useComposerAttachments';
import { useComposerPendingSkills } from './useComposerPendingSkills';
import { useComposerSend } from './useComposerSend';
import { useScopedPromptDraft } from './useScopedPromptDraft';
import { buildComposerPresentation } from './composerPresentation';
import { projectContextUsagePreview } from './projectContextUsagePreview';
import { useSelectedContextProfile } from './useSelectedContextProfile';
import { useComposerDomEffects } from './useComposerDomEffects';
import { persistSessionAgentId } from './sessionAgentId';
import { useQueuedHandoffSuggestion } from './useQueuedHandoffSuggestion';
import { isActiveRun } from './composerTurnIdle';
import type { AgentMode, ModeConfig } from '@shared/types/layout';

export function useComposer(options: {
  effectiveLeftCollapsed: boolean;
  leftToggleDisabled: boolean;
  toggleLeftSidebar: () => void | Promise<void>;
  openSettings: (section?: string) => void;
}) {
  const { effectiveLeftCollapsed, leftToggleDisabled, toggleLeftSidebar, openSettings } = options;
  const { t, language } = useI18n();

  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useCurrentSessionView();
  const currentRun = useSessionStore((state) => state.currentRun);
  const lastKnownUsage = useSessionStore((state) => state.lastKnownUsage);
  const usageStale = useSessionStore((state) => state.usageStale);
  const preparedTurnContext = useSessionStore((state) => state.preparedTurnContext);
  const conversationPreparationPhase = useSessionStore((state) => state.conversationPreparationPhase);
  // Only whether a turn is active: subscribing to the messages re-rendered App on every streaming commit.
  const hasActiveConversationTurn = useConversationStore((state) =>
    state.conversationMessages.some(
      (message) => message.role === 'assistant' && (message.status === 'draft' || message.status === 'streaming'),
    ),
  );
  const selectedAgentId = useComposerAgentId();
  const currentMode = selectedAgentId as AgentMode;
  const setSelectedAgentId = useCallback((agentId: string) => {
    void persistSessionAgentId(useProjectStore.getState().currentSessionId, agentId);
  }, []);
  const agentDefinitions = useAppSettingsStore((state) => state.settings.agents.definitions);
  const userInvocableAgents = agentDefinitions.filter((agent) => agent.enabled && agent.userInvocable);

  useEffect(() => {
    void useAppSettingsStore
      .getState()
      .reloadSettings()
      .catch((error: unknown) => console.warn('[composer] could not reload settings for the project', error));
  }, [currentProject?.projectId]);

  const selectedDeviceEntry = usePreparedSessionDevice(currentProject?.projectId, currentSession?.sessionId);
  const { promptValue, setPromptValue } = useScopedPromptDraft(currentProject?.projectId, currentSession?.sessionId);

  const hasActiveDebugRun = isActiveRun(currentRun);

  const attachments = useComposerAttachments({
    t,
    currentProject,
    currentSession,
    effectiveLeftCollapsed,
    leftToggleDisabled,
    toggleLeftSidebar,
  });
  const pendingSkills = useComposerPendingSkills({
    currentProject,
    currentSession,
  });
  const selectedAgent = userInvocableAgents.find((agent) => agent.id === selectedAgentId) ?? userInvocableAgents[0];
  const selectedContextProfile = useSelectedContextProfile();
  const contextUsagePreview = projectContextUsagePreview(
    lastKnownUsage,
    selectedContextProfile,
    conversationPreparationPhase,
  );
  const agentAccent = resolveAgentDisplay(selectedAgent?.id ?? selectedAgentId, agentDefinitions).accent;
  const builtinMode = AGENT_MODES.find((mode) => mode.id === currentMode);
  const currentModeConfig: ModeConfig = builtinMode
    ? { ...builtinMode, accentColor: selectedAgent?.accent ?? agentAccent }
    : {
        id: selectedAgent?.id ?? currentMode,
        label: selectedAgent?.name ?? currentMode,
        icon: selectedAgent?.icon ?? 'message-orbit',
        description: selectedAgent?.description ?? t('composer.agentProfile'),
        accentColor: selectedAgent?.accent ?? agentAccent,
        disabled: false,
      };
  const currentModeLabel = selectedAgent?.name ?? currentModeConfig.label;

  const send = useComposerSend({
    t,
    selectedAgentId,
    setSelectedAgentId,
    openSettings,
    currentProject,
    currentSession,
    currentRun,
    selectedDeviceEntry,
    hasActiveDebugRun,
    hasActiveConversationTurn,
    promptValue,
    setPromptValue,
    pendingAttachments: attachments.pendingAttachments,
    setPendingAttachments: attachments.setPendingAttachments,
    pendingSkillIds: pendingSkills.pendingSkillIds,
    setPendingSkillIds: pendingSkills.setPendingSkillIds,
    armPendingSkill: pendingSkills.armPendingSkill,
  });

  const hasMessageContent = Boolean(promptValue.trim());
  const hasPendingAttachments = attachments.pendingAttachments.some((attachment) => !attachment.error);
  const presentation = buildComposerPresentation({
    t,
    currentModeLabel,
    currentModeHint: agentArgumentHint(selectedAgent, language),
    hasProject: Boolean(currentProject),
    hasActiveDebugRun,
    isComposerBusy: send.isComposerBusy,
    stopPending: send.stopPending,
  });
  const capabilityState = useTurnControlsStore((state) => state.capabilityState);
  const modelReady = capabilityState.status === 'ready' || capabilityState.status === 'refreshing';
  const primaryButtonDisabled =
    send.stopPending ||
    (send.isComposerBusy
      ? currentRun?.status === 'stopping' && !hasActiveConversationTurn && !send.isPromptSending
      : !modelReady || (!hasMessageContent && !hasPendingAttachments));
  const handoff = useQueuedHandoffSuggestion({
    isComposerBusy: send.isPromptSending || hasActiveConversationTurn || hasActiveDebugRun,
    sessionId: currentSession?.sessionId,
    setPromptValue,
    sendPrompt: send.sendHandoffPrompt,
    inspectRequest: send.inspectHandoff,
  });

  useComposerDomEffects({
    selectedAgentId,
    userInvocableAgents,
    setSelectedAgentId,
  });

  return {
    promptValue,
    setPromptValue,
    pendingAttachments: attachments.pendingAttachments,
    setPendingAttachments: attachments.setPendingAttachments,
    pendingSkills: pendingSkills.pendingSkills,
    removePendingSkill: pendingSkills.removePendingSkill,
    promptInputRef,
    currentMode,
    currentModeConfig,
    currentModeLabel,
    selectedAgentId,
    userInvocableAgents,
    setSelectedAgentId,
    lastKnownUsage: contextUsagePreview.usage,
    usageEstimated: contextUsagePreview.estimated,
    usageStale,
    preparedTurnContext,
    conversationPreparationPhase,
    selectedContextProfile,
    hasActiveDebugRun,
    isComposerBusy: send.isComposerBusy,
    stopPending: send.stopPending,
    promptPlaceholder: presentation.promptPlaceholder,
    attachButtonLabel: presentation.attachButtonLabel,
    primaryButtonDisabled,
    primaryButtonDescription: presentation.primaryButtonDescription,
    handlePrimaryStop: send.handlePrimaryStop,
    handleAttachmentSelect: attachments.handleAttachmentSelect,
    handleFilesIngest: attachments.handleFilesIngest,
    handlePendingAttachmentRemove: attachments.handlePendingAttachmentRemove,
    fileInputRef: attachments.fileInputRef,
    isDropActive: attachments.isDropActive,
    setIsDropActive: attachments.setIsDropActive,
    handoff,
    handlePromptSend: send.handlePromptSend,
    planReviewContinuation: send.planReviewContinuation,
    handlePromptKeyDown: send.handlePromptKeyDown,
    setPromptValueDirect: setPromptValue,
  };
}
export type ComposerController = ReturnType<typeof useComposer>;
