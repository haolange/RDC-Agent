import React, { useMemo, useState } from 'react';
import type {
  AppSettings,
  AppTheme,
  FontScale,
  ReduceMotionPreference,
  ThemeChromeConfig,
  ThemePresetId,
  ThemeVariant,
} from '@shared/types/settings';
import { THEME_PRESET_CATALOG, getPresetChrome } from '@shared/theme/presets';
import { parseRdxThemeV1, serializeRdxThemeV1 } from '@shared/theme/rdxThemeV1';
import type { useI18n } from '../../../../i18n';
import { ColorField } from '../../../../ui/ColorField';
import { DropdownSelect } from '../../../../ui/DropdownSelect';
import { Switch } from '../../../../ui/Switch';
import './AppearanceSettings.css';

type Translate = ReturnType<typeof useI18n>['t'];

interface AppearanceSettingsProps {
  settings: AppSettings;
  onThemeChange: (theme: AppTheme) => void | Promise<void>;
  onFontScaleChange: (fontScale: FontScale) => void | Promise<void>;
  onComposerMarkdownChange: (enabled: boolean) => void | Promise<void>;
  onUsePointerCursorsChange: (enabled: boolean) => void | Promise<void>;
  onReduceMotionChange: (value: ReduceMotionPreference) => void | Promise<void>;
  onChromeThemeChange: (variant: ThemeVariant, chrome: Partial<ThemeChromeConfig>) => void | Promise<void>;
  t: Translate;
}

const RDC_LIGHT = getPresetChrome('rdc', 'light');
const RDC_DARK = getPresetChrome('rdc', 'dark');

function chromeVars(chrome: ThemeChromeConfig): React.CSSProperties {
  return {
    '--ap-surface': chrome.surface,
    '--ap-ink': chrome.ink,
    '--ap-accent': chrome.accent,
  } as React.CSSProperties;
}

function MiniWindow(props: { chrome: ThemeChromeConfig; className?: string }) {
  return (
    <span className={`appearance-mini-win ${props.className ?? ''}`} style={chromeVars(props.chrome)} aria-hidden="true">
      <span className="appearance-mini-title" />
      <span className="appearance-mini-body">
        <span className="appearance-mini-side" />
        <span className="appearance-mini-main" />
      </span>
    </span>
  );
}

function ThemeModeTile(props: {
  mode: AppTheme;
  active: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`appearance-mode-tile ${props.active ? 'is-active' : ''}`}
      data-testid={`appearance-theme-${props.mode}`}
      onClick={props.onSelect}
      aria-pressed={props.active}
    >
      {props.mode === 'system' ? (
        <span className="appearance-mode-preview appearance-mode-preview--system" aria-hidden="true">
          <MiniWindow chrome={RDC_LIGHT} />
          <MiniWindow chrome={RDC_DARK} />
        </span>
      ) : (
        <MiniWindow chrome={props.mode === 'light' ? RDC_LIGHT : RDC_DARK} className="appearance-mode-preview" />
      )}
      <span className="appearance-mode-label">{props.label}</span>
    </button>
  );
}

function AppearanceChromePreview(props: {
  chrome: ThemeChromeConfig;
  variant: ThemeVariant;
  label: string;
}) {
  return (
    <div
      className="appearance-preview-pane"
      style={chromeVars(props.chrome)}
      data-testid={`appearance-preview-${props.variant}`}
    >
      <div className="appearance-preview-side" aria-hidden="true">
        <span className="appearance-preview-nav appearance-preview-nav--accent" />
        <span className="appearance-preview-nav" />
        <span className="appearance-preview-nav" />
      </div>
      <div className="appearance-preview-main">
        <div className="appearance-preview-title">{props.label}</div>
        <div className="appearance-preview-line appearance-preview-line--wide" aria-hidden="true" />
        <div className="appearance-preview-line appearance-preview-line--mid" aria-hidden="true" />
        <div className="appearance-preview-cta" aria-hidden="true">Accent</div>
      </div>
    </div>
  );
}

function ChromeThemeCard(props: {
  variant: ThemeVariant;
  chrome: ThemeChromeConfig;
  t: Translate;
  onChange: (chrome: Partial<ThemeChromeConfig>) => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
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
    const next = getPresetChrome(presetId, props.variant);
    props.onChange({
      ...next,
      fonts: props.chrome.fonts,
    });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(serializeRdxThemeV1(props.chrome, props.variant));
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1600);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 1600);
    }
  };

  const handleImport = () => {
    const result = parseRdxThemeV1(importText, props.variant);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    props.onChange(result.chrome);
    setImportError(null);
    setImportOpen(false);
    setImportText('');
  };

  return (
    <div className="appearance-chrome-card" data-testid={`appearance-chrome-${props.variant}`}>
      <div className="appearance-chrome-header">
        <div className="settings-section-title">
          {props.variant === 'light' ? props.t('settings.appearanceLightTheme') : props.t('settings.appearanceDarkTheme')}
        </div>
        <div className="appearance-chrome-actions">
          <button type="button" className="button button-ghost button-sm" onClick={() => setImportOpen((v) => !v)}>
            {props.t('settings.appearanceImport')}
          </button>
          <button type="button" className="button button-ghost button-sm" onClick={() => void handleCopy()}>
            {copyState === 'copied'
              ? props.t('settings.appearanceCopied')
              : copyState === 'failed'
                ? props.t('settings.appearanceCopyFailed')
                : props.t('settings.appearanceCopyTheme')}
          </button>
          <div className="appearance-preset-picker">
            <DropdownSelect
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
        </div>
      </div>

      {importOpen && (
        <div className="appearance-import-panel">
          <textarea
            className="appearance-import-input input"
            data-testid={`appearance-import-${props.variant}`}
            value={importText}
            placeholder="rdx-theme-v1:{...}"
            onChange={(event) => setImportText(event.target.value)}
            rows={3}
          />
          {importError && <div className="appearance-import-error" role="alert">{importError}</div>}
          <div className="appearance-import-actions">
            <button type="button" className="button button-secondary button-sm" onClick={handleImport}>
              {props.t('settings.appearanceApplyImport')}
            </button>
          </div>
        </div>
      )}

      <div className="appearance-chrome-fields">
        <ColorField
          label={props.t('settings.appearanceAccent')}
          value={props.chrome.accent}
          testId={`appearance-accent-${props.variant}`}
          onChange={(accent) => props.onChange({ accent, presetId: props.chrome.presetId })}
        />
        <ColorField
          label={props.t('settings.appearanceBackground')}
          value={props.chrome.surface}
          testId={`appearance-surface-${props.variant}`}
          onChange={(surface) => props.onChange({ surface })}
        />
        <ColorField
          label={props.t('settings.appearanceForeground')}
          value={props.chrome.ink}
          testId={`appearance-ink-${props.variant}`}
          onChange={(ink) => props.onChange({ ink })}
        />
        <label className="appearance-text-field">
          <span className="settings-field-label">{props.t('settings.appearanceUiFont')}</span>
          <input
            type="text"
            className="input"
            value={props.chrome.fonts.ui ?? ''}
            placeholder="System default"
            data-testid={`appearance-ui-font-${props.variant}`}
            onChange={(event) => {
              const value = event.target.value.trim();
              props.onChange({ fonts: { ...props.chrome.fonts, ui: value || null } });
            }}
          />
        </label>
        <label className="appearance-text-field">
          <span className="settings-field-label">{props.t('settings.appearanceCodeFont')}</span>
          <input
            type="text"
            className="input"
            value={props.chrome.fonts.code ?? ''}
            placeholder="System default"
            data-testid={`appearance-code-font-${props.variant}`}
            onChange={(event) => {
              const value = event.target.value.trim();
              props.onChange({ fonts: { ...props.chrome.fonts, code: value || null } });
            }}
          />
        </label>
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
    </div>
  );
}

export const AppearanceSettings: React.FC<AppearanceSettingsProps> = ({
  settings,
  onThemeChange,
  onFontScaleChange,
  onComposerMarkdownChange,
  onUsePointerCursorsChange,
  onReduceMotionChange,
  onChromeThemeChange,
  t,
}) => {
  const light = settings.appearance.chromeThemes.light;
  const dark = settings.appearance.chromeThemes.dark;

  return (
    <section className="settings-page settings-page-appearance" data-testid="settings-appearance-page">
      <div className="appearance-mode-grid" role="group" aria-label={t('userMenu.theme')}>
        {(['system', 'light', 'dark'] as AppTheme[]).map((mode) => (
          <ThemeModeTile
            key={mode}
            mode={mode}
            active={settings.appearance.theme === mode}
            label={t(`theme.${mode}`)}
            onSelect={() => void onThemeChange(mode)}
          />
        ))}
      </div>

      <div className="appearance-live-preview" aria-hidden="true">
        <AppearanceChromePreview chrome={light} variant="light" label="ThemePreview" />
        <AppearanceChromePreview chrome={dark} variant="dark" label="ThemePreview" />
      </div>

      <ChromeThemeCard
        variant="light"
        chrome={light}
        t={t}
        onChange={(chrome) => void onChromeThemeChange('light', chrome)}
      />
      <ChromeThemeCard
        variant="dark"
        chrome={dark}
        t={t}
        onChange={(chrome) => void onChromeThemeChange('dark', chrome)}
      />

      <div className="settings-section appearance-preferences">
        <div className="settings-section-header">
          <div className="settings-section-title">{t('settings.appearancePreferences')}</div>
        </div>
        <div className="settings-preference-list settings-appearance-toggles">
          <div className="settings-preference-row settings-preference-row--switch">
            <div className="settings-preference-copy settings-option-block">
              <div className="settings-field-label">{t('settings.usePointerCursors')}</div>
              <div className="settings-help-text">{t('settings.usePointerCursorsHelp')}</div>
            </div>
            <Switch
              checked={settings.appearance.usePointerCursors}
              onCheckedChange={(enabled) => void onUsePointerCursorsChange(enabled)}
              aria-label={t('settings.usePointerCursors')}
            />
          </div>

          <div className="settings-preference-row">
            <div className="settings-preference-copy settings-option-block">
              <div className="settings-field-label">{t('settings.appearanceReduceMotion')}</div>
              <div className="settings-help-text">{t('settings.appearanceReduceMotionHelp')}</div>
            </div>
            <div className="user-menu-pill-group settings-inline-pills settings-choice-group">
              {(['system', 'on', 'off'] as ReduceMotionPreference[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`user-menu-pill ${settings.appearance.reduceMotion === value ? 'active' : ''}`}
                  data-testid={`appearance-reduce-motion-${value}`}
                  onClick={() => void onReduceMotionChange(value)}
                >
                  {t(`settings.appearanceReduceMotion.${value}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-preference-row">
            <div className="settings-preference-copy settings-option-block">
              <div className="settings-field-label">{t('userMenu.fontScale')}</div>
            </div>
            <div className="user-menu-pill-group settings-inline-pills settings-choice-group">
              {(['small', 'medium', 'large'] as FontScale[]).map((fontScale) => (
                <button
                  key={fontScale}
                  type="button"
                  className={`user-menu-pill ${settings.appearance.fontScale === fontScale ? 'active' : ''}`}
                  onClick={() => void onFontScaleChange(fontScale)}
                >
                  {t(`font.${fontScale}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-preference-row settings-preference-row--switch">
            <div className="settings-preference-copy settings-option-block">
              <div className="settings-field-label">{t('settings.composerMarkdown')}</div>
              <div className="settings-help-text">{t('settings.composerMarkdownHelp')}</div>
            </div>
            <Switch
              checked={settings.appearance.composerMarkdown}
              onCheckedChange={(enabled) => void onComposerMarkdownChange(enabled)}
              aria-label={t('settings.composerMarkdown')}
            />
          </div>
        </div>
      </div>
    </section>
  );
};
