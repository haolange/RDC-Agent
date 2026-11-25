import { useState } from 'react';
import { Input } from '../../../../ui/Input';
import { Button } from '../../../../ui/Button';
import { IconButton } from '../../../../ui/IconButton';
import { Chevron } from '../../../../ui/Chevron';
import { Popover } from '../../../../ui/Popover';
import { useDynStyle } from '../../../../lib/useDynStyle';
import { useI18n } from '../../../../i18n';
import type { ThemeVariant } from '@shared/types/settings';

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
}

interface FontOptionProps {
  family: string;
  selected: boolean;
  sample: string;
  label: string;
  onSelect: () => void;
}

/** One candidate row: the sample sentence rendered in that family, the family name underneath. */
function FontOption({ family, selected, sample, label, onSelect }: FontOptionProps) {
  const style = useDynStyle({ '--ap-font-sample': family });
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

function FontPreview({ family, sample, title }: { family: string; sample: string; title: string }) {
  const style = useDynStyle({ '--ap-font-sample': family });
  return (
    <div className="appearance-font-preview">
      <div className="appearance-font-preview-title">{title}</div>
      <div className="appearance-font-option-sample appearance-font-preview-sample" {...style}>{sample}</div>
    </div>
  );
}

export function AppearanceFontField({ kind, variant, value, onChange }: AppearanceFontFieldProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const label = kind === 'ui' ? t('settings.appearanceUiFont') : t('settings.appearanceCodeFont');
  const suggestions = kind === 'ui' ? UI_FONT_SUGGESTIONS : CODE_FONT_SUGGESTIONS;
  const sample = kind === 'ui' ? `${t('knowledgeCenter.title')} · Aa 0123` : 'float4 color = pixels[0];';
  const defaultFamily = kind === 'ui' ? 'var(--font-sans-default)' : 'var(--font-mono-default)';
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
          value={draft ?? value ?? ''}
          aria-labelledby={`appearance-font-${kind}-${variant}`}
          placeholder={systemDefault}
          spellCheck={false}
          data-testid={`appearance-${kind}-font-${variant}`}
          onChange={(event) => {
            setDraft(event.target.value);
            const next = event.target.value.trim();
            if (next !== (draft ?? value ?? '').trim()) onChange(next || null);
          }}
          onBlur={() => setDraft(null)}
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
              <Chevron direction="down" />
            </IconButton>
          )}
        >
          <div className="appearance-font-popover-head">
            <div className="appearance-font-popover-title">{t('settings.appearanceFontSuggestions')}</div>
          </div>
          <div className="appearance-font-options" role="radiogroup" aria-label={label}>
            <FontOption
              family={defaultFamily}
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
          <FontPreview family={value ?? defaultFamily} sample={sample} title={t('settings.appearanceFontPreview')} />
          <p className="appearance-font-popover-note">{t('settings.appearanceFontFreeTextHint')}</p>
        </Popover>
      </div>
    </div>
  );
}
