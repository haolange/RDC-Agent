import { useMemo, useState } from 'react';
import type {
  AppTheme,
  ThemeChromeConfig,
  ThemePresetId,
  ThemeVariant,
} from '@shared/types/settings';
import { THEME_PRESET_CATALOG, getPresetChrome } from '@shared/theme/presets';
import { parseRdxThemeV1, serializeRdxThemeV1 } from '@shared/theme/rdxThemeV1';
import type { useI18n } from '../../../../i18n';
import { cn } from '../../../../lib/cn';
import { useDynStyle } from '../../../../lib/useDynStyle';
import { ColorField } from '../../../../ui/ColorField';
import { DropdownSelect } from '../../../../ui/DropdownSelect';

export type AppearanceTranslate = ReturnType<typeof useI18n>['t'];

const RDC_LIGHT = getPresetChrome('rdc', 'light');
const RDC_DARK = getPresetChrome('rdc', 'dark');

function useChromeVars(chrome: ThemeChromeConfig) {
  return useDynStyle({
    '--ap-surface': chrome.surface,
    '--ap-ink': chrome.ink,
    '--ap-accent': chrome.accent,
  });
}

function MiniWindow(props: { chrome: ThemeChromeConfig; className?: string }) {
  const chromeStyle = useChromeVars(props.chrome);
  return (
    <span className={`appearance-mini-win ${props.className ?? ''}`} {...chromeStyle} aria-hidden="true">
      <span className="appearance-mini-title" />
      <span className="appearance-mini-body">
        <span className="appearance-mini-side" />
        <span className="appearance-mini-main" />
      </span>
    </span>
  );
}

export function ThemeModeTile(props: {
  mode: AppTheme;
  active: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn('appearance-mode-tile', props.active && 'is-active')}
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

export function ChromeThemeCard(props: {
  variant: ThemeVariant;
  chrome: ThemeChromeConfig;
  t: AppearanceTranslate;
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
