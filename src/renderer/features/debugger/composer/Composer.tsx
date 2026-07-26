import React, { useEffect, useMemo, useState } from 'react';
import { ContextUsageIndicator } from '../../../patterns/ContextUsageIndicator';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { ResolvedTheme } from '@shared/types/settings';
import { deriveComposeAccentVars } from '@shared/theme/composeAccent';
import { useI18n } from '../../../i18n';
import { useDynStyle } from '../../../lib/useDynStyle';
import { useLayoutStore } from '../../../stores/layoutStore';
import { useConversationStore } from '../../../stores/conversationStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import type { ComposerController } from './useComposer';
import { PermissionModeSelector } from './PermissionModeSelector';
import { EffortControl } from './EffortControl';
import { ToolApprovalRequestPanel, usePendingToolApprovalRequest } from './ToolApprovalRequestPanel';
import { UserInputRequestPanel, usePendingUserInputRequest } from './UserInputRequestPanel';
import { SlashCommandPopover } from './SlashCommandPopover';
import { useSlashCommand } from './useSlashCommand';
import { ComposerMarkdownInput, type ComposerMarkdownMode } from './ComposerMarkdownInput';
import { ComposerMarkdownModeTabs } from './ComposerMarkdownModeTabs';
import { ComposerAgentMenu } from './ComposerAgentMenu';
import { ComposerAttachmentChips } from './ComposerAttachmentChips';
import { buildComposerSessionScopeKey } from './composerSessionScope';

export interface ComposerProps {
  composer: ComposerController;
  hasOpenedCaptureForCurrentProject: boolean;
}

function getAgentCapability(agentId: string, definitions: AgentManifestDefinition[]): string {
  const manifest = definitions.find((d) => d.id === agentId);
  return manifest?.description ?? '';
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
  const activeAgentId = useConversationStore((state) => {
    const activeMsg = state.conversationMessages.find(
      (m) => m.role === 'assistant' && (m.status === 'streaming' || m.status === 'draft'),
    );
    return activeMsg?.agentId ?? null;
  });
  const setCurrentMode = useLayoutStore((state) => state.setCurrentMode);
  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useProjectStore((state) => state.currentSession);
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
    preparedTurnContext,
    conversationPreparationPhase,
    selectedContextWindowTokens,
    hasActiveDebugRun,
    isComposerBusy,
    promptPlaceholder,
    attachButtonLabel,
    primaryButtonDisabled,
    primaryButtonDescription,
    handlePrimaryStop,
    handleAttachmentSelect,
    handlePendingAttachmentRemove,
    handlePromptSend,
    handlePromptKeyDown,
  } = composer;
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
    <div
      className={`composer-shell ${isComposerBusy ? 'is-running' : ''}${composerMarkdown ? ' has-markdown-mode' : ''}`}
      {...composeAccentStyle}
    >
      {composerMarkdown ? (
        <ComposerMarkdownModeTabs
          mode={markdownMode}
          onModeChange={setMarkdownMode}
          disabled={isComposerBusy}
        />
      ) : null}
      <ComposerAttachmentChips
        pendingSkillIds={pendingSkillIds}
        pendingAttachments={pendingAttachments}
        removePendingSkill={removePendingSkill}
        handlePendingAttachmentRemove={handlePendingAttachmentRemove}
        armedSkillMeta={t('app.armedSkillMeta')}
        removeArmedSkillLabel={(skillId) => t('app.removeArmedSkill', { skillId })}
        removeAttachmentLabel={(fileName) => t('app.removeAttachment', { fileName })}
      />
      <div className="composer-input-row">
        {composerMarkdown ? (
          <ComposerMarkdownInput
            key={composerScopeKey}
            value={promptValue}
            onChange={setPromptValue}
            onSend={() => void handlePromptSend()}
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
          <button
            type="button"
            className="composer-attach-button"
            data-testid="composer-attach-button"
            onClick={() => void handleAttachmentSelect()}
            disabled={isComposerBusy}
            title={attachButtonLabel}
            aria-label={attachButtonLabel}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
          <ComposerAgentMenu
            modeMenuRef={modeMenuRef}
            modeMenuOpen={modeMenuOpen}
            setModeMenuOpen={setModeMenuOpen}
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
          <EffortControl
            agentId={selectedAgentId}
            currentSession={currentSession}
            disabled={isComposerBusy}
          />
          <ContextUsageIndicator
            usage={lastKnownUsage}
            prepared={preparedTurnContext}
            phase={conversationPreparationPhase}
            selectedContextWindowTokens={selectedContextWindowTokens}
            stale={usageStale && !hasActiveDebugRun}
          />
          <button
            type="button"
            className={`chat-send-button primary ${isComposerBusy ? 'is-stop' : ''}`}
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
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
