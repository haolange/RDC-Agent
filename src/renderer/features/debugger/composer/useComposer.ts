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
  const promptPlaceholder = currentMode === 'ask'
    ? (language === 'zh-CN'
      ? '向 Ask 描述问题、目标或需要打开的 .rdc Capture'
      : 'Ask about the issue, goal, or .rdc capture to open')
    : (language === 'zh-CN'
      ? `向 ${currentModeLabel} 描述目标、异常或验证需求`
      : `Describe the goal, anomaly, or verification request for ${currentModeLabel}`);
  const attachButtonLabel = !currentProject
    ? (language === 'zh-CN'
      ? '选择项目后可附加图片、文件或 .rdc Capture'
      : 'Select a project before attaching images, files, or .rdc captures')
    : (language === 'zh-CN'
      ? '附加图片、文件或 .rdc Capture'
      : 'Attach images, files, or .rdc captures');
  const sendButtonLabel = language === 'zh-CN' ? '发送' : 'Send';
  const startButtonLabel = language === 'zh-CN' ? '开始' : 'Start';
  const stopButtonLabel = hasActiveDebugRun
    ? (language === 'zh-CN' ? '停止当前调试' : 'Stop current debug run')
    : (language === 'zh-CN' ? '停止当前请求' : 'Stop current request');
  const primaryButtonLabel = send.isComposerBusy ? stopButtonLabel : (currentMode === 'ask' || hasActiveDebugRun ? sendButtonLabel : startButtonLabel);
  const primaryButtonDescription = send.isComposerBusy
    ? stopButtonLabel
    : language === 'zh-CN'
      ? `${primaryButtonLabel} ${currentModeLabel} 消息`
      : `${primaryButtonLabel} ${currentModeLabel} message`;
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
    hasActiveDebugRun,
    isComposerBusy: send.isComposerBusy,
    promptPlaceholder,
    attachButtonLabel,
    primaryButtonDisabled,
    primaryButtonDescription,
    handlePrimaryStop: send.handlePrimaryStop,
    handleAttachmentSelect: attachments.handleAttachmentSelect,
    handlePendingAttachmentRemove: attachments.handlePendingAttachmentRemove,
    handlePromptSend: send.handlePromptSend,
    handlePromptKeyDown: send.handlePromptKeyDown,
    setPromptValueDirect: setPromptValue,
  };
}

export type ComposerController = ReturnType<typeof useComposer>;
