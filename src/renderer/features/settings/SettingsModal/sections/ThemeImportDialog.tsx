import { useState } from 'react';
import type { ThemeChromeConfig, ThemeVariant } from '@shared/types/settings';
import { Button } from '../../../../ui/Button';
import { InlineError } from '../../../../ui/InlineError';
import { Textarea } from '../../../../ui/Textarea';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { useDynStyle } from '../../../../lib/useDynStyle';
import { previewThemeImport, type AppearanceTranslate } from './appearanceChromeModel';

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
      <Textarea
        className="appearance-import-input"
        data-testid={`appearance-import-${variant}`}
        value={text}
        placeholder="rdx-theme-v1:{...}"
        spellCheck={false}
        rows={5}
        error={preview.state === 'invalid'}
        onChange={(event) => setText(event.target.value)}
      />
      {preview.state === 'invalid' ? <InlineError>{preview.error}</InlineError> : null}
      {preview.state === 'valid' ? <ThemeImportSwatches chrome={preview.chrome} /> : null}
    </TaskDialog>
  );
}
