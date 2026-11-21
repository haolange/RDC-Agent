import { THEME_PRESET_CATALOG, getPresetChrome, type ThemePresetDefinition } from '@shared/theme/presets';
import { useDynStyle } from '../../../../lib/useDynStyle';
import { Chevron } from '../../../../ui/Chevron';
import type { ThemeChromeConfig, ThemeVariant } from '@shared/types/settings';
import type { AppearanceTranslate } from './appearanceChromeModel';

/** A preset as a tiny window: its surface, a sidebar stroke and an accent bar, named on hover. */
function PresetTile({ preset, variant, selected, onSelect }: {
  preset: ThemePresetDefinition;
  variant: ThemeVariant;
  selected: boolean;
  onSelect: () => void;
}) {
  const chrome = preset[variant];
  const colors = useDynStyle({ '--preset-surface': chrome.surface, '--preset-ink': chrome.ink, '--preset-accent': chrome.accent });
  return (
    <button type="button" className={`appearance-preset-tile${selected ? ' is-selected' : ''}`} {...colors}
      aria-pressed={selected} aria-label={preset.label} data-tooltip={preset.label}
      data-testid={`appearance-preset-option-${variant}-${preset.id}`} onClick={onSelect}>
      <span className="appearance-preset-tile-side" />
      <span className="appearance-preset-tile-line" />
      <span className="appearance-preset-tile-accent" />
    </button>
  );
}

/**
 * One row per mode: the mode's name, every preset as a tile, and「自定义」which opens the editor for that mode. Picking a
 * preset applies it at once and keeps the mode's fonts.
 */
export function AppearancePresetRow({ variant, chrome, editing, onChange, onEdit, t }: {
  variant: ThemeVariant;
  chrome: ThemeChromeConfig;
  editing: boolean;
  onChange: (chrome: Partial<ThemeChromeConfig>) => void;
  onEdit: () => void;
  t: AppearanceTranslate;
}) {
  return (
    <div className="appearance-preset-row" data-testid={`appearance-preset-row-${variant}`}>
      <span className="appearance-preset-row-label">{t(variant === 'light' ? 'settings.appearanceLightTheme' : 'settings.appearanceDarkTheme')}</span>
      <div className="appearance-preset-row-tiles" role="group" aria-label={t('settings.appearancePreset')}>
        {THEME_PRESET_CATALOG.map((preset) => (
          <PresetTile key={preset.id} preset={preset} variant={variant} selected={chrome.presetId === preset.id}
            onSelect={() => onChange({ ...getPresetChrome(preset.id, variant), fonts: chrome.fonts })} />
        ))}
      </div>
      <button type="button" className={`appearance-preset-customize${editing ? ' is-open' : ''}`} aria-expanded={editing} onClick={onEdit}>
        {t('settings.appearanceCustomize')}
        <Chevron open={editing} size={14} />
      </button>
    </div>
  );
}
