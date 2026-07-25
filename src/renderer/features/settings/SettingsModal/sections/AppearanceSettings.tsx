import React from 'react';
import type {
  AppSettings,
  AppTheme,
  FontScale,
  ReduceMotionPreference,
  ThemeChromeConfig,
  ThemeVariant,
} from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { Switch } from '../../../../ui/Switch';
import {
  AppearanceChromePreview,
  ChromeThemeCard,
  ThemeModeTile,
} from './AppearanceChromeParts';
import {
  BrowserQaDesktopOnlyNotice,
  isBrowserQaDesktopOnlySurface,
} from '../../../../platform/BrowserQaDesktopOnlyNotice';
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
  const desktopOnly = isBrowserQaDesktopOnlySurface();
  const guard = <T,>(action: () => T): void => {
    if (desktopOnly) return;
    void action();
  };

  return (
    <section className="settings-page settings-page-appearance" data-testid="settings-appearance-page">
      <BrowserQaDesktopOnlyNotice kind="settingsWrite" testId="browser-qa-appearance-desktop-only" />
      <div className="appearance-mode-grid" role="group" aria-label={t('userMenu.theme')}>
        {(['system', 'light', 'dark'] as AppTheme[]).map((mode) => (
          <ThemeModeTile
            key={mode}
            mode={mode}
            active={settings.appearance.theme === mode}
            label={t(`theme.${mode}`)}
            onSelect={() => guard(() => onThemeChange(mode))}
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
        onChange={(chrome) => guard(() => onChromeThemeChange('light', chrome))}
      />
      <ChromeThemeCard
        variant="dark"
        chrome={dark}
        t={t}
        onChange={(chrome) => guard(() => onChromeThemeChange('dark', chrome))}
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
              onCheckedChange={(enabled) => guard(() => onUsePointerCursorsChange(enabled))}
              aria-label={t('settings.usePointerCursors')}
              disabled={desktopOnly}
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
                  disabled={desktopOnly}
                  onClick={() => guard(() => onReduceMotionChange(value))}
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
                  disabled={desktopOnly}
                  onClick={() => guard(() => onFontScaleChange(fontScale))}
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
              onCheckedChange={(enabled) => guard(() => onComposerMarkdownChange(enabled))}
              aria-label={t('settings.composerMarkdown')}
              disabled={desktopOnly}
            />
          </div>
        </div>
      </div>
    </section>
  );
};
