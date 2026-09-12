import React from 'react';
import { Tabs } from '../../ui/Tabs';
import { useI18n } from '../../i18n';
import type { ComposerMarkdownMode } from './ComposerMarkdownInput';
import './ComposerMarkdownInput.css';

interface ComposerMarkdownModeTabsProps {
  mode: ComposerMarkdownMode;
  onModeChange: (mode: ComposerMarkdownMode) => void;
  disabled?: boolean;
}

/** Mode selection is positioned above the composer by its layout wrapper. */
export const ComposerMarkdownModeTabs: React.FC<ComposerMarkdownModeTabsProps> = ({
  mode,
  onModeChange,
  disabled = false,
}) => {
  const { t } = useI18n();
  return (
    <div className="composer-markdown-toolbar" data-testid="composer-markdown-toolbar">
      <Tabs
        variant="segmented"
        label={t('settings.composerMarkdown')}
        value={mode}
        onChange={(next) => onModeChange(next === 'preview' ? 'preview' : 'write')}
        tabs={[
          { id: 'write', label: t('composer.markdownWrite'), description: t('composer.markdownWriteTip'), disabled },
          { id: 'preview', label: t('composer.markdownPreview'), description: t('composer.markdownPreviewTip'), disabled },
        ]}
      />
    </div>
  );
};

export default ComposerMarkdownModeTabs;
