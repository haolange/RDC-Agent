import React from 'react';
import { useI18n } from '../../../i18n';
import type { ComposerMarkdownMode } from './ComposerMarkdownInput';
import './ComposerMarkdownInput.css';

interface ComposerMarkdownModeTabsProps {
  mode: ComposerMarkdownMode;
  onModeChange: (mode: ComposerMarkdownMode) => void;
  disabled?: boolean;
}

/** Write/Preview capsule — lives in the composer footer, never over prompt text. */
export const ComposerMarkdownModeTabs: React.FC<ComposerMarkdownModeTabsProps> = ({
  mode,
  onModeChange,
  disabled = false,
}) => {
  const { t } = useI18n();
  const writeLabel = t('composer.markdownWrite');
  const previewLabel = t('composer.markdownPreview');
  const writeTip = t('composer.markdownWriteTip');
  const previewTip = t('composer.markdownPreviewTip');

  return (
    <div
      className="composer-markdown-toolbar"
      role="tablist"
      aria-label={t('settings.composerMarkdown')}
      data-testid="composer-markdown-toolbar"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'write'}
        aria-label={writeTip}
        title={writeTip}
        className={`composer-markdown-tab ${mode === 'write' ? 'is-active' : ''}`}
        data-testid="composer-markdown-tab-write"
        onClick={() => onModeChange('write')}
        disabled={disabled}
      >
        {writeLabel}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'preview'}
        aria-label={previewTip}
        title={previewTip}
        className={`composer-markdown-tab ${mode === 'preview' ? 'is-active' : ''}`}
        data-testid="composer-markdown-tab-preview"
        onClick={() => onModeChange('preview')}
        disabled={disabled}
      >
        {previewLabel}
      </button>
    </div>
  );
};

export default ComposerMarkdownModeTabs;
