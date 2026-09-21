import { useState } from 'react';
import type { ThemeChromeConfig, ThemeVariant } from '@shared/types/settings';
import { Button } from '../../../../ui/Button';
import { InlineError } from '../../../../ui/InlineError';
import { Textarea } from '../../../../ui/Textarea';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { useDynStyle } from '../../../../lib/useDynStyle';
import { SettingsField } from '../parts';
import { previewThemeImport, themeImportErrorMessage, type AppearanceTranslate } from './appearanceChromeModel';

interface ThemeImportDialogProps {
  open: boolean;
  variant: ThemeVariant;
  onApply: (chrome: ThemeChromeConfig) => void;
  onClose: () => void;
  t: AppearanceTranslate;
}

function ThemeImportSwatches({ chrome }: { chrome: ThemeChromeConfig }) {
  const style = useDynStyle({
    '--ap-surface': chrome.surface,
    '--ap-ink': chrome.ink,
    '--ap-accent': chrome.accent,
  });
  return (
    <div className="appearance-import-preview" {...style} data-testid="appearance-import-preview">
      <span className="appearance-import-swatch appearance-import-swatch--accent" />
      <span className="appearance-import-swatch appearance-import-swatch--surface" />
      <span className="appearance-import-swatch appearance-import-swatch--ink" />
      <code className="appearance-import-preview-code">
        {chrome.accent} · {chrome.surface} · {chrome.ink}
      </code>
    </div>
  );
}

export function ThemeImportDialog({ open, variant, onApply, onClose, t }: ThemeImportDialogProps) {
  const [text, setText] = useState('');
  const preview = previewThemeImport(text, variant);
  const inputId = `appearance-import-input-${variant}`;

  const close = () => {
    setText('');
    onClose();
  };

  const apply = () => {
    if (preview.state !== 'valid') return;
    onApply(preview.chrome);
    close();
  };

  return (
    <TaskDialog
      open={open}
      size="md"
      title={t('settings.appearanceImportTitle')}
      description={t('settings.appearanceImportHint')}
      onClose={close}
      closeLabel={t('dialog.cancel')}
      dataTestId={`appearance-import-dialog-${variant}`}
      footer={(
        <>
          <Button variant="ghost" onClick={close}>{t('dialog.cancel')}</Button>
          <Button variant="primary" disabled={preview.state !== 'valid'} onClick={apply}>
            {t('settings.appearanceApplyImport')}
          </Button>
        </>
      )}
    >
      <SettingsField label={t('settings.appearanceImportField')} htmlFor={inputId}>
        <Textarea
          id={inputId}
          className="appearance-import-input"
          data-testid={`appearance-import-${variant}`}
          value={text}
          placeholder={t('settings.appearanceImportPlaceholder')}
          spellCheck={false}
          error={preview.state === 'invalid'}
          onChange={(event) => setText(event.target.value)}
        />
      </SettingsField>
      {preview.state === 'empty' ? (
        <p className="settings-help-text appearance-import-status" role="status">{t('settings.appearanceImportEmpty')}</p>
      ) : null}
      {preview.state === 'invalid' ? <InlineError>{themeImportErrorMessage(preview.error, t)}</InlineError> : null}
      {preview.state === 'valid' ? (
        <>
          <p className="settings-help-text appearance-import-status" role="status">{t('settings.appearanceImportValid')}</p>
          <ThemeImportSwatches chrome={preview.chrome} />
        </>
      ) : null}
    </TaskDialog>
  );
}
