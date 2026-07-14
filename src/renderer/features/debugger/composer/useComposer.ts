import { useEffect, useRef, useState } from 'react';
import type { AgentMode, ModeConfig } from '@shared/types/layout';
import { AGENT_MODES } from '@shared/constants/agents';
import { useI18n } from '../../../i18n';
import { useConversationStore } from '../../../stores/conversationStore';
import { useLayoutStore } from '../../../stores/layoutStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useDeviceStore } from '../../../stores/deviceStore';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { useComposerAttachments } from './useComposerAttachments';
import { useComposerSend } from './useComposerSend';
import { useScopedPromptDraft } from './useScopedPromptDraft';
import { toConversationMode } from './composerSendHelpers';
import { useNextRequestContextPreview } from './useNextRequestContextPreview';
import { buildComposerPresentation } from './composerPresentation';

export function useComposer(options: {
  showNotice: (message: string) => void;
  hasOpenedCaptureForCurrentProject: boolean;
  effectiveLeftCollapsed: boolean;
  leftToggleDisabled: boolean;
  toggleLeftSidebar: () => void | Promise<void>;
  openSettings: (section?: string) => void;
}) {
  const { showNotice, hasOpenedCaptureForCurrentProject, effectiveLeftCollapsed, leftToggleDisabled, toggleLeftSidebar, openSettings } = options;
  const { t, language } = useI18n();

  const [modeMenuOpen, setModeMenuOpen] = useState(false);

  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useProjectStore((state) => state.currentSession);
  const currentRun = useSessionStore((state) => state.currentRun);
  const lastKnownUsage = useSessionStore((state) => state.lastKnownUsage);
  const usageStale = useSessionStore((state) => state.usageStale);
  const conversationMessages = useConversationStore((state) => state.conversationMessages);
  const currentMode = useLayoutStore((state) => state.currentMode);
  const setCurrentMode = useLayoutStore((state) => state.setCurrentMode);
  const userInvocableAgents = useAppSettingsStore((state) =>
    state.settings.agents.definitions.filter((agent) => agent.enabled && agent.userInvocable),
  );
  const [selectedAgentId, setSelectedAgentId] = useState(userInvocableAgents[0]?.id ?? 'ask');

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
  const selectedAgent = userInvocableAgents.find((agent) => agent.id === selectedAgentId) ?? userInvocableAgents[0];
  const nextRequestContext = useNextRequestContextPreview({
    project: currentProject,
    session: currentSession,
    currentRun,
    replayDeviceId: selectedDeviceEntry?.id ?? null,
    mode: toConversationMode(currentMode),
    agentId: selectedAgentId,
    draft: promptValue,
    attachments: attachments.pendingAttachments,
  });
  const currentModeConfig: ModeConfig = AGENT_MODES.find((mode) => mode.id === currentMode) ?? {
    id: selectedAgent?.id ?? currentMode,
    label: selectedAgent?.name ?? currentMode,
    icon: 'message-orbit',
    description: selectedAgent?.description ?? 'Agent profile',
    accentColor: '#33d1ff',
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
    hasOpenedCaptureForCurrentProject,
    hasActiveDebugRun,
    hasActiveConversationTurn,
    promptValue,
    setPromptValue,
    pendingAttachments: attachments.pendingAttachments,
    setPendingAttachments: attachments.setPendingAttachments,
  });

  const hasMessageContent = Boolean(promptValue.trim());
  const hasPendingAttachments = attachments.pendingAttachments.length > 0;
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

  useEffect(() => {
    const fallback = userInvocableAgents[0];
    if (!fallback || userInvocableAgents.some((agent) => agent.id === selectedAgentId)) return;
    setSelectedAgentId(fallback.id);
    setCurrentMode(fallback.id as AgentMode);
  }, [selectedAgentId, setCurrentMode, userInvocableAgents]);

  useEffect(() => {
    if (!modeMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!modeMenuRef.current?.contains(target)) {
        setModeMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModeMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [modeMenuOpen]);

  useEffect(() => {
    const textarea = promptInputRef.current;
    if (!textarea) return;

    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [currentMode, promptValue]);

  return {
    promptValue,
    setPromptValue,
    pendingAttachments: attachments.pendingAttachments,
    setPendingAttachments: attachments.setPendingAttachments,
    modeMenuOpen,
    setModeMenuOpen,
    promptInputRef,
    modeMenuRef,
    currentMode,
    currentModeConfig,
    currentModeLabel,
    selectedAgentId,
    userInvocableAgents,
    setSelectedAgentId,
    lastKnownUsage,
    usageStale,
    nextRequestContextProjection: nextRequestContext.projection,
    nextRequestContextPending: nextRequestContext.pending,
    hasActiveDebugRun,
    isComposerBusy: send.isComposerBusy,
    promptPlaceholder: presentation.promptPlaceholder,
    attachButtonLabel: presentation.attachButtonLabel,
    primaryButtonDisabled,
    primaryButtonDescription: presentation.primaryButtonDescription,
    handlePrimaryStop: send.handlePrimaryStop,
    handleAttachmentSelect: attachments.handleAttachmentSelect,
    handlePendingAttachmentRemove: attachments.handlePendingAttachmentRemove,
    handlePromptSend: send.handlePromptSend,
    handlePromptKeyDown: send.handlePromptKeyDown,
    setPromptValueDirect: setPromptValue,
  };
}

export type ComposerController = ReturnType<typeof useComposer>;
