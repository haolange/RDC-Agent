import { useCallback, useEffect, useRef } from 'react';
import type { ModeConfig } from '@shared/types/layout';
import { AGENT_MODES, resolveAgentDisplay } from '@shared/constants/agents';
import { COMPOSE_ACCENT_FALLBACK } from '@shared/theme/composeAccent';
import { useI18n } from '../../../i18n';
import { useConversationStore } from '../../../stores/conversationStore';
import { useLayoutStore } from '../../../stores/layoutStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useDeviceStore } from '../../../stores/deviceStore';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { useComposerAttachments } from './useComposerAttachments';
import { useComposerPendingSkills } from './useComposerPendingSkills';
import { useComposerSend } from './useComposerSend';
import { useScopedPromptDraft } from './useScopedPromptDraft';
import { buildComposerPresentation } from './composerPresentation';
import { projectContextUsagePreview } from './projectContextUsagePreview';
import { useSelectedContextProfile } from './useSelectedContextProfile';
import { useComposerDomEffects } from './useComposerDomEffects';
import { hydrateComposerAgentFromSession, persistSessionAgentId } from './sessionAgentId';

export function useComposer(options: {
  showNotice: (message: string) => void;
  effectiveLeftCollapsed: boolean;
  leftToggleDisabled: boolean;
  toggleLeftSidebar: () => void | Promise<void>;
  openSettings: (section?: string) => void;
}) {
  const { showNotice, effectiveLeftCollapsed, leftToggleDisabled, toggleLeftSidebar, openSettings } = options;
  const { t, language } = useI18n();

  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useProjectStore((state) => state.currentSession);
  const currentRun = useSessionStore((state) => state.currentRun);
  const lastKnownUsage = useSessionStore((state) => state.lastKnownUsage);
  const usageStale = useSessionStore((state) => state.usageStale);
  const preparedTurnContext = useSessionStore((state) => state.preparedTurnContext);
  const conversationPreparationPhase = useSessionStore((state) => state.conversationPreparationPhase);
  const conversationMessages = useConversationStore((state) => state.conversationMessages);
  const currentMode = useLayoutStore((state) => state.currentMode);
  const setCurrentMode = useLayoutStore((state) => state.setCurrentMode);
  const selectedAgentId = useLayoutStore((state) => state.selectedAgentId);
  const setSelectedAgentId = useCallback((agentId: string) => {
    void persistSessionAgentId(useProjectStore.getState().currentSession?.sessionId, agentId);
  }, []);

  useEffect(() => {
    hydrateComposerAgentFromSession(currentSession);
  }, [currentSession?.sessionId, currentSession?.agentId]);
  const agentDefinitions = useAppSettingsStore((state) => state.settings.agents.definitions);
  const userInvocableAgents = agentDefinitions.filter((agent) => agent.enabled && agent.userInvocable);

  useEffect(() => {
    void useAppSettingsStore.getState().reloadSettings().catch(() => undefined);
  }, [currentProject?.projectId]);

  const devices = useDeviceStore((state) => state.devices);
  const selectedDevice = useDeviceStore((state) => state.selectedDevice);
  const selectedDeviceEntry = devices.find((device) => device.id === selectedDevice);
  const { promptValue, setPromptValue } = useScopedPromptDraft(
    currentProject?.projectId,
    currentSession?.sessionId,
  );

  const hasActiveDebugRun = Boolean(currentRun && ['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running', 'stopping'].includes(currentRun.status));
  const hasActiveConversationTurn = conversationMessages.some((message) =>
    message.role === 'assistant' && (message.status === 'draft' || message.status === 'streaming'));

  const attachments = useComposerAttachments({
    showNotice,
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
        description: selectedAgent?.description ?? 'Agent profile',
        accentColor: selectedAgent?.accent ?? agentAccent ?? COMPOSE_ACCENT_FALLBACK,
        disabled: false,
      };
  const currentModeLabel = selectedAgent?.name ?? currentModeConfig.label;

  const send = useComposerSend({
    showNotice,
    t,
    currentMode,
    selectedAgentId,
    setSelectedAgentId,
    setCurrentMode,
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
    language,
    currentMode,
    currentModeLabel,
    hasProject: Boolean(currentProject),
    hasActiveDebugRun,
    isComposerBusy: send.isComposerBusy,
  });
  const primaryButtonDisabled = send.isComposerBusy
    ? currentRun?.status === 'stopping' && !hasActiveConversationTurn && !send.isPromptSending
    : (!hasMessageContent && !hasPendingAttachments);

  useComposerDomEffects({
    promptInputRef,
    currentMode,
    promptValue,
    selectedAgentId,
    userInvocableAgents,
    setSelectedAgentId,
    setCurrentMode,
  });

  return {
    promptValue,
    setPromptValue,
    pendingAttachments: attachments.pendingAttachments,
    setPendingAttachments: attachments.setPendingAttachments,
    pendingSkillIds: pendingSkills.pendingSkillIds,
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
    handlePromptSend: send.handlePromptSend,
    handlePromptKeyDown: send.handlePromptKeyDown,
    setPromptValueDirect: setPromptValue,
  };
}

export type ComposerController = ReturnType<typeof useComposer>;
