import { useMemo, useState } from 'react';
import { THEME_PRESET_CATALOG, getPresetChrome } from '@shared/theme/presets';
import { serializeRdcTheme } from '@shared/theme/rdcTheme';
import { Button } from '../../../../ui/Button';
import { ColorField } from '../../../../ui/ColorField';
import { Select } from '../../../../ui/Select';
import { useI18n } from '../../../../i18n';
import { AppearanceFontField } from './AppearanceFontField';
import { ThemeImportDialog } from './ThemeImportDialog';
import type { ThemeChromeConfig, ThemePresetId, ThemeVariant } from '@shared/types/settings';
import type { AppearanceTranslate } from './appearanceChromeModel';

export type { AppearanceTranslate };

export function ChromeThemeCard(props: {
  variant: ThemeVariant;
  chrome: ThemeChromeConfig;
  onChange: (chrome: Partial<ThemeChromeConfig>) => void;
}) {
  const { t } = useI18n();
  const [importOpen, setImportOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const presetOptions = useMemo(
    () =>
      THEME_PRESET_CATALOG.map((preset) => ({
        value: preset.id,
        label: preset.label,
        // The selected preset previews the live accent; the others show their own.
        swatchColor: preset.id === props.chrome.presetId ? props.chrome.accent : preset[props.variant].accent,
        testId: `appearance-preset-option-${props.variant}-${preset.id}`,
      })),
    [props.chrome.accent, props.chrome.presetId, props.variant],
  );

  const handlePreset = (presetId: ThemePresetId) => {
    props.onChange({ ...getPresetChrome(presetId, props.variant), fonts: props.chrome.fonts });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(serializeRdcTheme(props.chrome, props.variant));
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1600);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 1600);
    }
  };

  const title = props.variant === 'light' ? t('settings.appearanceLightTheme') : t('settings.appearanceDarkTheme');

  return (
    <div className="appearance-chrome-card" data-testid={`appearance-chrome-${props.variant}`}>
      <div className="appearance-chrome-header">
        <h3 className="appearance-chrome-title">{t('settings.appearanceEditingTheme', { theme: title })}</h3>
        <div className="appearance-chrome-actions">
          <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)}>
            {t('settings.appearanceImport')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void handleCopy()}>
            {copyState === 'copied'
              ? t('settings.appearanceCopied')
              : copyState === 'failed'
                ? t('settings.appearanceCopyFailed')
                : t('settings.appearanceCopyTheme')}
          </Button>
        </div>
      </div>

      <div className="appearance-chrome-fields">
        <div className="appearance-preset-picker">
          <span className="settings-field-label">{t('settings.appearancePreset')}</span>
          <Select
            value={props.chrome.presetId}
            options={presetOptions}
            onChange={(value) => handlePreset(value as ThemePresetId)}
            dataTestId={`appearance-preset-${props.variant}`}
            ariaLabel={t('settings.appearancePreset')}
            variant="inline"
            menuAlign="end"
            minMenuWidth={280}
            className="appearance-preset-dropdown"
            triggerClassName="appearance-preset-trigger"
            menuClassName="settings-select-menu appearance-preset-menu"
          />
        </div>
        <ColorField
          label={t('settings.appearanceAccent')}
          areaLabel={t('settings.colorPickerArea')}
          hueLabel={t('settings.colorPickerHue')}
          pickerTitle={t('settings.colorPickerTitle')}
          currentLabel={t('settings.colorPickerCurrent')}
          value={props.chrome.accent}
          testId={`appearance-accent-${props.variant}`}
          onChange={(accent) => props.onChange({ accent, presetId: props.chrome.presetId })}
        />
        <ColorField
          label={t('settings.appearanceBackground')}
          areaLabel={t('settings.colorPickerArea')}
          hueLabel={t('settings.colorPickerHue')}
          pickerTitle={t('settings.colorPickerTitle')}
          currentLabel={t('settings.colorPickerCurrent')}
          value={props.chrome.surface}
          testId={`appearance-surface-${props.variant}`}
          onChange={(surface) => props.onChange({ surface })}
        />
        <ColorField
          label={t('settings.appearanceForeground')}
          areaLabel={t('settings.colorPickerArea')}
          hueLabel={t('settings.colorPickerHue')}
          pickerTitle={t('settings.colorPickerTitle')}
          currentLabel={t('settings.colorPickerCurrent')}
          value={props.chrome.ink}
          testId={`appearance-ink-${props.variant}`}
          onChange={(ink) => props.onChange({ ink })}
        />
        <AppearanceFontField
          kind="ui"
          variant={props.variant}
          value={props.chrome.fonts.ui}
          onChange={(ui) => props.onChange({ fonts: { ...props.chrome.fonts, ui } })}
        />
        <AppearanceFontField
          kind="code"
          variant={props.variant}
          value={props.chrome.fonts.code}
          onChange={(code) => props.onChange({ fonts: { ...props.chrome.fonts, code } })}
        />
        <label className="appearance-contrast-field">
          <span className="settings-field-label">
            {t('settings.appearanceContrast')}
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
      />
    </div>
  );
}
