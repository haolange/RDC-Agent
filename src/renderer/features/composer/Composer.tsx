import React, { useEffect, useMemo, useState } from 'react';
import { ContextUsageIndicator } from '../../patterns/ContextUsageIndicator';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { ResolvedTheme } from '@shared/types/settings';
import { deriveComposeAccentVars } from '@shared/theme/composeAccent';
import { useI18n } from '../../i18n';
import { useDynStyle } from '../../lib/useDynStyle';
import { useLayoutStore } from '../../stores/layoutStore';
import { useProjectStore } from '../../stores/projectStore';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import type { ComposerController } from './useComposer';
import { PermissionModeSelector } from './PermissionModeSelector';
import { EffortControl } from './EffortControl';
import { ComposerModelOverrideMenu } from './ComposerModelOverrideMenu';
import { ToolApprovalRequestPanel, usePendingToolApprovalRequest } from './ToolApprovalRequestPanel';
import { UserInputRequestPanel, usePendingUserInputRequest } from './UserInputRequestPanel';
import { SlashCommandPopover } from './SlashCommandPopover';
import { useSlashCommand } from './useSlashCommand';
import { ComposerMarkdownInput, type ComposerMarkdownMode } from './ComposerMarkdownInput';
import { ComposerMarkdownModeTabs } from './ComposerMarkdownModeTabs';
import { ComposerAgentMenu } from './ComposerAgentMenu';
import { ComposerMenuRegistryProvider, useComposerMenu } from './useComposerMenuRegistry';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { ComposerAttachIngest } from './ComposerAttachIngest';
import { ComposerAttachmentTray } from './ComposerAttachmentTray';
import { buildComposerSessionScopeKey } from '../../lib/composerSessionScope';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { useComposerAttachmentDrop } from './useComposerAttachmentDrop';
import { useComposerVisionCapability } from './useComposerVisionCapability';
import './Debugger.composer-panels.css';
import './composer-chrome.css';
import './composer-effort.css';
import './composer-attachments.css';

export interface ComposerProps {
  composer: ComposerController;
}

function getAgentCapability(agentId: string, definitions: AgentManifestDefinition[]): string {
  const manifest = definitions.find((d) => d.id === agentId);
  return manifest?.description ?? '';
}

function RegisteredContextUsageIndicator(
  props: Omit<React.ComponentProps<typeof ContextUsageIndicator>, 'menu'>,
): React.ReactElement {
  const menu = useComposerMenu('usage');
  return <ContextUsageIndicator {...props} menu={menu} />;
}

export const Composer: React.FC<ComposerProps> = ({
  composer,
}) => {
  const { t } = useI18n();
  const composerMarkdown = useAppSettingsStore((state) => state.settings.appearance.composerMarkdown);
  const [markdownMode, setMarkdownMode] = useState<ComposerMarkdownMode>('write');
  const appearanceTheme = useAppSettingsStore((state) => state.settings.appearance.theme);
  const systemTheme = useAppSettingsStore((state) => state.systemTheme);
  const resolvedTheme: ResolvedTheme = appearanceTheme === 'system' ? systemTheme : appearanceTheme;
  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useProjectStore((state) => state.currentSession);
  const activeAgentId = useComposerSessionContextStore((state) => (
    state.activeTurn?.sessionId === (currentSession?.sessionId ?? 'no-session')
      ? state.activeTurn.agentId
      : null
  ));
  const setCurrentMode = useLayoutStore((state) => state.setCurrentMode);
  const composerScopeKey = useMemo(
    () => buildComposerSessionScopeKey(currentProject?.projectId, currentSession?.sessionId),
    [currentProject?.projectId, currentSession?.sessionId],
  );
  const pendingToolApproval = usePendingToolApprovalRequest();
  const pendingUserInput = usePendingUserInputRequest();

  const slashCommand = useSlashCommand(
    composer.promptValue,
    composer.setPromptValueDirect,
    (commandName) => composer.setPromptValueDirect(`/${commandName} `),
  );

  const {
    promptValue,
    setPromptValue,
    pendingAttachments,
    pendingSkillIds,
    removePendingSkill,
    promptInputRef,
    currentMode,
    currentModeConfig,
    currentModeLabel,
    selectedAgentId,
    userInvocableAgents,
    setSelectedAgentId,
    lastKnownUsage,
    usageEstimated,
    usageStale,
    preparedTurnContext,
    conversationPreparationPhase,
    selectedContextProfile,
    isComposerBusy,
    promptPlaceholder,
    attachButtonLabel,
    primaryButtonDisabled,
    primaryButtonDescription,
    handlePrimaryStop,
    handleAttachmentSelect,
    handleFilesIngest,
    handlePendingAttachmentRemove,
    fileInputRef,
    isDropActive,
    setIsDropActive,
    handlePromptSend,
    handlePromptKeyDown,
  } = composer;
  const visionSupported = useComposerVisionCapability(selectedAgentId, currentSession);
  const attachmentDrop = useComposerAttachmentDrop({
    disabled: isComposerBusy,
    setIsDropActive,
    handleFilesIngest,
  });
  const selectedAgentDefinition = userInvocableAgents.find((agent) => agent.id === selectedAgentId);
  const selectedAgentCapability = getAgentCapability(selectedAgentId, userInvocableAgents);
  const composeAccentVars = useMemo(
    () => deriveComposeAccentVars(currentModeConfig.accentColor, resolvedTheme),
    [currentModeConfig.accentColor, resolvedTheme],
  );
  const composeAccentStyle = useDynStyle({ ...composeAccentVars });

  useEffect(() => {
    if (!composerMarkdown || isComposerBusy) {
      setMarkdownMode('write');
    }
  }, [composerMarkdown, isComposerBusy]);

  if (pendingToolApproval) {
    return (
      <div
        className="composer-shell composer-shell-tool-approval"
        {...composeAccentStyle}
      >
        <ToolApprovalRequestPanel request={pendingToolApproval} />
      </div>
    );
  }

  if (pendingUserInput) {
    return (
      <div
        className="composer-shell composer-shell-user-input"
        {...composeAccentStyle}
      >
        <UserInputRequestPanel request={pendingUserInput} />
      </div>
    );
  }

  return (
    <ComposerMenuRegistryProvider>
    <div
      className={`composer-shell ${isComposerBusy ? 'is-running' : ''}${composerMarkdown ? ' has-markdown-mode' : ''}${isDropActive ? ' is-drop-active' : ''}`}
      {...composeAccentStyle}
      onDragOver={attachmentDrop.handleDragOver}
      onDragLeave={attachmentDrop.handleDragLeave}
      onDrop={attachmentDrop.handleDrop}
      onPaste={attachmentDrop.handlePaste}
    >
      <ComposerAttachIngest
        fileInputRef={fileInputRef}
        isDropActive={isDropActive}
        dropHint={t('app.attachDropHint')}
        onFiles={(files) => void handleFilesIngest(files)}
      />
      {composerMarkdown ? (
        <ComposerMarkdownModeTabs
          mode={markdownMode}
          onModeChange={setMarkdownMode}
          disabled={isComposerBusy}
        />
      ) : null}
      <ComposerAttachmentTray
        onMaterialChange={(id, material) => composer.setPendingAttachments(current => current.map(item => item.id === id ? { ...item, material } : item))}
        pendingSkillIds={pendingSkillIds}
        pendingAttachments={pendingAttachments}
        composerScopeKey={composerScopeKey}
        visionUnsupported={!visionSupported}
        removePendingSkill={removePendingSkill}
        handlePendingAttachmentRemove={handlePendingAttachmentRemove}
        armedSkillMeta={t('app.armedSkillMeta')}
        removeArmedSkillLabel={(skillId) => t('app.removeArmedSkill', { skillId })}
        removeAttachmentLabel={(fileName) => t('app.removeAttachment', { fileName })}
        visionUnsupportedLabel={t('app.attachVisionUnsupported')}
      />
      <div className="composer-input-row">
        {composerMarkdown ? (
          <ComposerMarkdownInput
            key={composerScopeKey}
            value={promptValue}
            onChange={setPromptValue}
            onSend={() => void handlePromptSend()}
            onPasteFiles={(files) => void handleFilesIngest(files)}
            placeholder={promptPlaceholder}
            mode={markdownMode}
            disabled={isComposerBusy}
          />
        ) : (
          <textarea
            key={composerScopeKey}
            ref={promptInputRef}
            className="chat-input composer-textarea"
            name="debuggerPrompt"
            value={promptValue}
            onChange={(event) => setPromptValue(event.target.value)}
            onKeyDown={handlePromptKeyDown}
            placeholder={promptPlaceholder}
            aria-label={promptPlaceholder}
            rows={1}
          />
        )}
        {slashCommand.visible ? (
          <SlashCommandPopover
            filterText={slashCommand.filterText}
            onSelect={slashCommand.onSelect}
            onDismiss={slashCommand.onDismiss}
          />
        ) : null}
      </div>
      <div className="composer-footer-bar" data-testid="composer-footer-bar">
        <div className="composer-toolbar-group composer-toolbar-group-left">
          <IconButton
            className="composer-attach-button"
            data-testid="composer-attach-button"
            size="sm"
            label={attachButtonLabel}
            title={attachButtonLabel}
            disabled={isComposerBusy}
            onClick={() => void handleAttachmentSelect()}
          >
            <Icon name="plus" size={14} />
          </IconButton>
          <ComposerAgentMenu
            currentMode={currentMode}
            currentModeConfig={currentModeConfig}
            currentModeLabel={currentModeLabel}
            selectedAgentId={selectedAgentId}
            selectedAgentDefinition={selectedAgentDefinition}
            selectedAgentCapability={selectedAgentCapability}
            userInvocableAgents={userInvocableAgents}
            activeAgentId={activeAgentId}
            setSelectedAgentId={setSelectedAgentId}
            setCurrentMode={setCurrentMode}
          />
          <PermissionModeSelector />
        </div>
        <div className="composer-toolbar-group composer-toolbar-group-right">
          <ComposerModelOverrideMenu
            agentId={selectedAgentId}
            currentSession={currentSession}
          />
          <EffortControl
            agentId={selectedAgentId}
            currentSession={currentSession}
            disabled={isComposerBusy}
          />
          <RegisteredContextUsageIndicator
            usage={lastKnownUsage}
            prepared={preparedTurnContext}
            phase={conversationPreparationPhase}
            selectedProfile={selectedContextProfile}
            stale={usageStale}
            estimated={usageEstimated}
          />
          <Button
            variant={isComposerBusy ? 'danger' : 'primary'}
            size="sm"
            className="chat-send-button"
            data-testid={isComposerBusy ? 'debugger-stop-button' : 'debugger-start-button'}
            onClick={() => void (isComposerBusy ? handlePrimaryStop() : handlePromptSend())}
            disabled={primaryButtonDisabled}
            aria-label={primaryButtonDescription}
            title={primaryButtonDescription}
          >
            {isComposerBusy ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 19V5m-6 6 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </Button>
        </div>
      </div>
    </div>
    </ComposerMenuRegistryProvider>
  );
};
