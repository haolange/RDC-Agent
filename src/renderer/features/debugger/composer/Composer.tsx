import React from 'react';
import { ModeGlyph } from '../../../ui/ModeGlyph';
import { ContextUsageIndicator } from '../../../patterns/ContextUsageIndicator';
import type { AgentMode } from '@shared/types/layout';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import { formatBytes } from '../../../services/attachmentHelpers';
import { useI18n } from '../../../i18n';
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
import { ComposerMarkdownInput } from './ComposerMarkdownInput';

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
  const activeAgentId = useConversationStore((state) => {
    const activeMsg = state.conversationMessages.find(
      (m) => m.role === 'assistant' && (m.status === 'streaming' || m.status === 'draft'),
    );
    return activeMsg?.agentId ?? null;
  });
  const setCurrentMode = useLayoutStore((state) => state.setCurrentMode);
  const currentSession = useProjectStore((state) => state.currentSession);
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
    nextRequestContextProjection,
    nextRequestContextPending,
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

  if (pendingToolApproval) {
    return (
      <div
        className="composer-shell composer-shell-tool-approval"
        style={{ ['--composer-mode-accent' as string]: currentModeConfig.accentColor }}
      >
        <ToolApprovalRequestPanel request={pendingToolApproval} />
      </div>
    );
  }

  if (pendingUserInput) {
    return (
      <div
        className="composer-shell composer-shell-user-input"
        style={{ ['--composer-mode-accent' as string]: currentModeConfig.accentColor }}
      >
        <UserInputRequestPanel request={pendingUserInput} />
      </div>
    );
  }

  return (
    <div
      className={`composer-shell ${isComposerBusy ? 'is-running' : ''}`}
      style={{ ['--composer-mode-accent' as string]: currentModeConfig.accentColor }}
    >
      {pendingAttachments.length > 0 && (
        <div className="composer-attachments" data-testid="composer-attachments">
          {pendingAttachments.map((attachment) => (
            <div key={attachment.id} className={`composer-attachment-chip ${attachment.kind}`}>
              <span className="composer-attachment-chip-icon" aria-hidden="true">
                {attachment.kind === 'image' ? 'IMG' : 'FILE'}
              </span>
              <span className="composer-attachment-chip-copy">
                <span className="composer-attachment-chip-name">{attachment.fileName}</span>
                <span className="composer-attachment-chip-meta">{formatBytes(attachment.size)}</span>
              </span>
              <button
                type="button"
                className="composer-attachment-chip-remove"
                onClick={() => handlePendingAttachmentRemove(attachment.id)}
                aria-label={t('app.removeAttachment', { fileName: attachment.fileName })}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="composer-input-row">
        {composerMarkdown ? (
          <ComposerMarkdownInput
            value={promptValue}
            onChange={setPromptValue}
            onSend={() => void handlePromptSend()}
            placeholder={promptPlaceholder}
            disabled={isComposerBusy}
          />
        ) : (
          <textarea
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
          <div ref={modeMenuRef} className="composer-agent-menu">
            <button
              type="button"
              className={`composer-agent-pill ${modeMenuOpen ? 'open' : ''}`}
              data-testid="composer-mode-pill"
              onClick={() => setModeMenuOpen((current) => !current)}
              aria-haspopup="menu"
              aria-expanded={modeMenuOpen}
              title={selectedAgentCapability || currentModeLabel}
            >
              <span className="composer-agent-pill-icon" aria-hidden="true">
                <ModeGlyph mode={currentMode} icon={selectedAgentDefinition?.icon ?? currentModeConfig.icon} size={15} strokeWidth={1.9} />
              </span>
              <span className="composer-agent-pill-label">{currentModeLabel}</span>
              <span className="composer-agent-pill-caret" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </button>
            {modeMenuOpen && (
              <div className="composer-agent-menu-popup" role="menu">
                {userInvocableAgents.map((agent) => {
                  const agentMode: AgentMode = agent.id;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      className={`composer-agent-menu-item ${selectedAgentId === agent.id ? 'active' : ''}`}
                      data-testid={`mode-menu-item-${agent.id}`}
                      role="menuitemradio"
                      aria-checked={selectedAgentId === agent.id}
                      onClick={() => {
                        setSelectedAgentId(agent.id);
                        setCurrentMode(agentMode);
                        setModeMenuOpen(false);
                      }}
                    >
                      <span className="composer-agent-menu-item-copy">
                        <span className="composer-agent-menu-item-icon" aria-hidden="true">
                          <ModeGlyph mode={agentMode} icon={agent.icon ?? undefined} size={15} strokeWidth={1.9} />
                        </span>
                        <span className="composer-agent-menu-item-label">{agent.name}</span>
                        {activeAgentId === agent.id ? (
                          <span className="composer-agent-status-dot is-active" aria-label="Active" />
                        ) : null}
                      </span>
                      {agent.description ? (
                        <span className="composer-agent-menu-item-tooltip" role="tooltip">
                          {agent.description}
                        </span>
                      ) : null}
                      {selectedAgentId === agent.id ? <span className="composer-agent-menu-item-check">✓</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
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
            projection={nextRequestContextProjection}
            pending={nextRequestContextPending}
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
