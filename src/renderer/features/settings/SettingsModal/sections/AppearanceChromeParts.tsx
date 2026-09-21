import { useMemo, useState } from 'react';
import type { ThemeChromeConfig, ThemePresetId, ThemeVariant } from '@shared/types/settings';
import { THEME_PRESET_CATALOG, getPresetChrome } from '@shared/theme/presets';
import { serializeRdcThemeV1 } from '@shared/theme/rdcThemeV1';
import { useDynStyle } from '../../../../lib/useDynStyle';
import { Button } from '../../../../ui/Button';
import { ColorField } from '../../../../ui/ColorField';
import { Select } from '../../../../ui/Select';
import { AppearanceFontField } from './AppearanceFontField';
import { ThemeImportDialog } from './ThemeImportDialog';
import type { AppearanceTranslate } from './appearanceChromeModel';

export type { AppearanceTranslate };

function useChromeVars(chrome: ThemeChromeConfig) {
  return useDynStyle({
    '--ap-surface': chrome.surface,
    '--ap-ink': chrome.ink,
    '--ap-accent': chrome.accent,
  });
}

export function AppearanceChromePreview(props: {
  chrome: ThemeChromeConfig;
  variant: ThemeVariant;
  label: string;
}) {
  const chromeStyle = useChromeVars(props.chrome);
  return (
    <div
      className="appearance-preview-pane"
      {...chromeStyle}
      data-testid={`appearance-preview-${props.variant}`}
      aria-hidden="true"
    >
      <div className="appearance-preview-side">
        <span className="appearance-preview-nav appearance-preview-nav--accent" />
        <span className="appearance-preview-nav" />
        <span className="appearance-preview-nav" />
      </div>
      <div className="appearance-preview-main">
        <div className="appearance-preview-line appearance-preview-line--wide" />
        <div className="appearance-preview-line appearance-preview-line--mid" />
        <div className="appearance-preview-cta" />
      </div>
    </div>
  );
}

export function ChromeThemeCard(props: {
  variant: ThemeVariant;
  chrome: ThemeChromeConfig;
  t: AppearanceTranslate;
  onChange: (chrome: Partial<ThemeChromeConfig>) => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const presetOptions = useMemo(
    () => THEME_PRESET_CATALOG.map((preset) => ({
      value: preset.id,
      label: preset.label,
      // Selected row + trigger follow live chrome accent; other rows keep catalog accents.
      swatchColor: preset.id === props.chrome.presetId
        ? props.chrome.accent
        : preset[props.variant].accent,
      testId: `appearance-preset-option-${props.variant}-${preset.id}`,
    })),
    [props.chrome.accent, props.chrome.presetId, props.variant],
  );

  const handlePreset = (presetId: ThemePresetId) => {
    props.onChange({ ...getPresetChrome(presetId, props.variant), fonts: props.chrome.fonts });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(serializeRdcThemeV1(props.chrome, props.variant));
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1600);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 1600);
    }
  };

  const title = props.variant === 'light'
    ? props.t('settings.appearanceLightTheme')
    : props.t('settings.appearanceDarkTheme');

  return (
    <div className="appearance-chrome-card" data-testid={`appearance-chrome-${props.variant}`}>
      <div className="appearance-chrome-header">
        <div className="settings-section-title">{title}</div>
        <div className="appearance-chrome-actions">
          <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)}>
            {props.t('settings.appearanceImport')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void handleCopy()}>
            {copyState === 'copied'
              ? props.t('settings.appearanceCopied')
              : copyState === 'failed'
                ? props.t('settings.appearanceCopyFailed')
                : props.t('settings.appearanceCopyTheme')}
          </Button>
        </div>
      </div>

      <AppearanceChromePreview chrome={props.chrome} variant={props.variant} label={title} />

      <div className="appearance-chrome-fields">
        <div className="appearance-preset-picker">
          <span className="settings-field-label">{props.t('settings.appearancePreset')}</span>
          <Select
            value={props.chrome.presetId}
            options={presetOptions}
            onChange={(value) => handlePreset(value as ThemePresetId)}
            dataTestId={`appearance-preset-${props.variant}`}
            ariaLabel={props.t('settings.appearancePreset')}
            variant="inline"
            menuAlign="end"
            minMenuWidth={280}
            className="appearance-preset-dropdown"
            triggerClassName="appearance-preset-trigger"
            menuClassName="settings-select-menu appearance-preset-menu"
          />
        </div>
        <ColorField
          label={props.t('settings.appearanceAccent')}
          areaLabel={props.t('settings.colorPickerArea')}
          hueLabel={props.t('settings.colorPickerHue')}
          pickerTitle={props.t('settings.colorPickerTitle')}
          currentLabel={props.t('settings.colorPickerCurrent')}
          value={props.chrome.accent}
          testId={`appearance-accent-${props.variant}`}
          onChange={(accent) => props.onChange({ accent, presetId: props.chrome.presetId })}
        />
        <ColorField
          label={props.t('settings.appearanceBackground')}
          areaLabel={props.t('settings.colorPickerArea')}
          hueLabel={props.t('settings.colorPickerHue')}
          pickerTitle={props.t('settings.colorPickerTitle')}
          currentLabel={props.t('settings.colorPickerCurrent')}
          value={props.chrome.surface}
          testId={`appearance-surface-${props.variant}`}
          onChange={(surface) => props.onChange({ surface })}
        />
        <ColorField
          label={props.t('settings.appearanceForeground')}
          areaLabel={props.t('settings.colorPickerArea')}
          hueLabel={props.t('settings.colorPickerHue')}
          pickerTitle={props.t('settings.colorPickerTitle')}
          currentLabel={props.t('settings.colorPickerCurrent')}
          value={props.chrome.ink}
          testId={`appearance-ink-${props.variant}`}
          onChange={(ink) => props.onChange({ ink })}
        />
        <AppearanceFontField
          kind="ui"
          variant={props.variant}
          value={props.chrome.fonts.ui}
          onChange={(ui) => props.onChange({ fonts: { ...props.chrome.fonts, ui } })}
          t={props.t}
        />
        <AppearanceFontField
          kind="code"
          variant={props.variant}
          value={props.chrome.fonts.code}
          onChange={(code) => props.onChange({ fonts: { ...props.chrome.fonts, code } })}
          t={props.t}
        />
        <label className="appearance-contrast-field">
          <span className="settings-field-label">
            {props.t('settings.appearanceContrast')}
            <span className="appearance-contrast-value">{props.chrome.contrast}</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={props.chrome.contrast}
            data-testid={`appearance-contrast-${props.variant}`}
            onChange={(event) => props.onChange({ contrast: Number(event.target.value) })}
          />
        </label>
      </div>

      <ThemeImportDialog
        open={importOpen}
        variant={props.variant}
        onApply={(chrome) => props.onChange(chrome)}
        onClose={() => setImportOpen(false)}
        t={props.t}
      />
    </div>
  );
}
