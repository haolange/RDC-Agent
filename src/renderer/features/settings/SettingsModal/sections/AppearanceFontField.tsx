import { useState } from 'react';
import type { ThemeVariant } from '@shared/types/settings';
import { Input } from '../../../../ui/Input';
import { IconButton } from '../../../../ui/IconButton';
import { Icon } from '../../../../ui/Icon';
import { Popover } from '../../../../ui/Popover';
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

export function AppearanceFontField({ kind, variant, value, onChange, t }: AppearanceFontFieldProps) {
  const [open, setOpen] = useState(false);
  const label = kind === 'ui' ? t('settings.appearanceUiFont') : t('settings.appearanceCodeFont');
  const suggestions = kind === 'ui' ? UI_FONT_SUGGESTIONS : CODE_FONT_SUGGESTIONS;

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
          placeholder={t('settings.appearanceFontSystemDefault')}
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
          <div className="appearance-font-popover-title">{t('settings.appearanceFontSuggestions')}</div>
          <button
            type="button"
            className={`appearance-font-option${value === null ? ' is-selected' : ''}`}
            aria-pressed={value === null}
            onClick={() => apply(null)}
          >
            {t('settings.appearanceFontSystemDefault')}
          </button>
          {suggestions.map((family) => (
            <button
              key={family}
              type="button"
              className={`appearance-font-option${value === family ? ' is-selected' : ''}`}
              aria-pressed={value === family}
              onClick={() => apply(family)}
            >
              {family}
            </button>
          ))}
          <p className="appearance-font-popover-note">{t('settings.appearanceFontFreeTextHint')}</p>
        </Popover>
      </div>
    </div>
  );
}
