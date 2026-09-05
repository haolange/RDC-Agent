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

  return (
    <section className="settings-page settings-page-appearance" data-testid="settings-appearance-page" data-settings-search="appearance">
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
        <AppearanceChromePreview chrome={light} variant="light" label={t('theme.light')} />
        <AppearanceChromePreview chrome={dark} variant="dark" label={t('theme.dark')} />
      </div>

      <div className="appearance-theme-editors">
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
      </div>

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

          <div className="settings-preference-row" data-settings-search="font-scale">
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
