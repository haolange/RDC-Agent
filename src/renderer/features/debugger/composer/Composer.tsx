import React from 'react';
import { ModeGlyph } from '../../../ui/ModeGlyph';
import { ContextUsageIndicator } from '../../../patterns/ContextUsageIndicator';
import { AGENT_MODES } from '@shared/constants/agents';
import { formatBytes } from '../../../services/attachmentHelpers';
import { useI18n } from '../../../i18n';
import { useLayoutStore } from '../../../stores/layoutStore';
import type { ComposerController } from './useComposer';

export interface ComposerProps {
  composer: ComposerController;
  hasOpenedCaptureForCurrentProject: boolean;
}

export const Composer: React.FC<ComposerProps> = ({
  composer,
  hasOpenedCaptureForCurrentProject,
}) => {
  const { t, language } = useI18n();
  const setCurrentMode = useLayoutStore((state) => state.setCurrentMode);

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
    currentRunUsage,
    hasActiveDebugRun,
    isComposerBusy,
    promptPlaceholder,
    attachButtonLabel,
    primaryButtonDisabled,
    primaryButtonDescription,
    openCaptureRequiredLabel,
    modeLabels,
    handlePrimaryStop,
    handleAttachmentSelect,
    handlePendingAttachmentRemove,
    handlePromptSend,
    handlePromptKeyDown,
  } = composer;

  return (
    <div
      className="composer-shell"
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
            >
              <span className="composer-agent-pill-icon" aria-hidden="true">
                <ModeGlyph mode={currentMode} size={15} strokeWidth={1.9} />
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
                {AGENT_MODES.map((mode) => {
                  const executionModeDisabled = mode.id !== 'ask' && !hasOpenedCaptureForCurrentProject;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      className={`composer-agent-menu-item ${currentMode === mode.id ? 'active' : ''} ${executionModeDisabled ? 'disabled' : ''}`}
                      data-testid={`mode-menu-item-${mode.id}`}
                      role="menuitemradio"
                      aria-checked={currentMode === mode.id}
                      aria-disabled={executionModeDisabled}
                      disabled={executionModeDisabled}
                      title={executionModeDisabled ? openCaptureRequiredLabel : mode.description}
                      onClick={() => {
                        if (executionModeDisabled) {
                          return;
                        }
                        setCurrentMode(mode.id);
                        setModeMenuOpen(false);
                      }}
                    >
                      <span className="composer-agent-menu-item-copy">
                        <span className="composer-agent-menu-item-icon" aria-hidden="true">
                          <ModeGlyph mode={mode.id} size={15} strokeWidth={1.9} />
                        </span>
                        <span className="composer-agent-menu-item-label">{modeLabels[mode.id]}</span>
                        {executionModeDisabled ? (
                          <span className="composer-agent-menu-item-hint">{openCaptureRequiredLabel}</span>
                        ) : null}
                      </span>
                      {currentMode === mode.id ? <span className="composer-agent-menu-item-check">●</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="composer-toolbar-group composer-toolbar-group-right">
          <ContextUsageIndicator usage={hasActiveDebugRun ? currentRunUsage : null} language={language} />
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
