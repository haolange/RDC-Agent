import { useState } from 'react';
import type { ThemeVariant } from '@shared/types/settings';
import { Input } from '../../../../ui/Input';
import { Button } from '../../../../ui/Button';
import { IconButton } from '../../../../ui/IconButton';
import { Icon } from '../../../../ui/Icon';
import { Popover } from '../../../../ui/Popover';
import { useDynStyle } from '../../../../lib/useDynStyle';
import type { AppearanceTranslate } from './appearanceChromeModel';

/**
 * Engine-guaranteed generic families only. The app never enumerates installed
 * fonts, so these are offered as examples next to the free-text field rather
 * than as a claim about what this machine has.
 */
const UI_FONT_SUGGESTIONS = ['system-ui', 'ui-sans-serif', 'sans-serif', 'serif'] as const;
const CODE_FONT_SUGGESTIONS = ['ui-monospace', 'monospace'] as const;

interface AppearanceFontFieldProps {
  kind: 'ui' | 'code';
  variant: ThemeVariant;
  value: string | null;
  onChange: (value: string | null) => void;
  t: AppearanceTranslate;
}

interface FontOptionProps {
  family: string | null;
  selected: boolean;
  sample: string;
  label: string;
  onSelect: () => void;
}

/** One candidate row: the sample sentence rendered in that family, the family name underneath. */
function FontOption({ family, selected, sample, label, onSelect }: FontOptionProps) {
  const style = useDynStyle({ '--ap-font-sample': family ?? 'inherit' });
  return (
    <Button
      variant="ghost"
      role="radio"
      aria-checked={selected}
      className={`appearance-font-option${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
    >
      <span className="appearance-font-option-mark" aria-hidden="true" />
      <span className="appearance-font-option-copy">
        <span className="appearance-font-option-sample" {...style}>{sample}</span>
        <span className="appearance-font-option-name">{label}</span>
      </span>
    </Button>
  );
}

function FontPreview({ family, sample, title }: { family: string | null; sample: string; title: string }) {
  const style = useDynStyle({ '--ap-font-sample': family ?? 'inherit' });
  return (
    <div className="appearance-font-preview">
      <div className="appearance-font-preview-title">{title}</div>
      <div className="appearance-font-option-sample appearance-font-preview-sample" {...style}>{sample}</div>
    </div>
  );
}

export function AppearanceFontField({ kind, variant, value, onChange, t }: AppearanceFontFieldProps) {
  const [open, setOpen] = useState(false);
  const label = kind === 'ui' ? t('settings.appearanceUiFont') : t('settings.appearanceCodeFont');
  const suggestions = kind === 'ui' ? UI_FONT_SUGGESTIONS : CODE_FONT_SUGGESTIONS;
  const sample = t('settings.appearanceFontSample');
  const systemDefault = t('settings.appearanceFontSystemDefault');

  const apply = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className="appearance-text-field">
      <span className="settings-field-label" id={`appearance-font-${kind}-${variant}`}>{label}</span>
      <div className="appearance-font-control">
        <Input
          value={value ?? ''}
          aria-labelledby={`appearance-font-${kind}-${variant}`}
          placeholder={systemDefault}
          spellCheck={false}
          data-testid={`appearance-${kind}-font-${variant}`}
          onChange={(event) => {
            const next = event.target.value.trim();
            onChange(next || null);
          }}
        />
        <Popover
          open={open}
          onOpenChange={setOpen}
          align="end"
          className="appearance-font-popover"
          trigger={(
            <IconButton
              label={t('settings.appearanceFontSuggestions')}
              size="sm"
              data-testid={`appearance-${kind}-font-menu-${variant}`}
            >
              <Icon name="chevron-down" size={14} />
            </IconButton>
          )}
        >
          <div className="appearance-font-popover-head">
            <div className="appearance-font-popover-title">{t('settings.appearanceFontSuggestions')}</div>
            <p className="appearance-font-popover-note">{t('settings.appearanceFontSuggestionsHint')}</p>
          </div>
          <div className="appearance-font-options" role="radiogroup" aria-label={label}>
            <FontOption
              family={null}
              selected={value === null}
              sample={sample}
              label={systemDefault}
              onSelect={() => apply(null)}
            />
            {suggestions.map((family) => (
              <FontOption
                key={family}
                family={family}
                selected={value === family}
                sample={sample}
                label={family}
                onSelect={() => apply(family)}
              />
            ))}
          </div>
          <FontPreview family={value} sample={sample} title={t('settings.appearanceFontPreview')} />
          <p className="appearance-font-popover-note">{t('settings.appearanceFontFreeTextHint')}</p>
        </Popover>
      </div>
    </div>
  );
}
