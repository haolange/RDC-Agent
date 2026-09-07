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
import { Pill } from '../../../../ui/Pill';
import { Switch } from '../../../../ui/Switch';
import { SettingsField, SettingsSection } from '../parts';
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

      <SettingsSection title={t('settings.appearancePreferences')} className="appearance-preferences">
        <div className="settings-preference-list settings-appearance-toggles">
          <SettingsField
            layout="row"
            label={t('settings.usePointerCursors')}
            description={t('settings.usePointerCursorsHelp')}
          >
            <Switch
              checked={settings.appearance.usePointerCursors}
              onCheckedChange={(enabled) => void onUsePointerCursorsChange(enabled)}
              aria-label={t('settings.usePointerCursors')}
            />
          </SettingsField>

          <SettingsField
            layout="row"
            label={t('settings.appearanceReduceMotion')}
            description={t('settings.appearanceReduceMotionHelp')}
          >
            <div className="settings-choice-group">
              {(['system', 'on', 'off'] as ReduceMotionPreference[]).map((value) => (
                <Pill
                  key={value}
                  selected={settings.appearance.reduceMotion === value}
                  data-testid={`appearance-reduce-motion-${value}`}
                  onClick={() => void onReduceMotionChange(value)}
                >
                  {t(`settings.appearanceReduceMotion.${value}`)}
                </Pill>
              ))}
            </div>
          </SettingsField>

          <SettingsField layout="row" label={t('userMenu.fontScale')} search="font-scale">
            <div className="settings-choice-group">
              {(['small', 'medium', 'large'] as FontScale[]).map((fontScale) => (
                <Pill
                  key={fontScale}
                  selected={settings.appearance.fontScale === fontScale}
                  onClick={() => void onFontScaleChange(fontScale)}
                >
                  {t(`font.${fontScale}`)}
                </Pill>
              ))}
            </div>
          </SettingsField>

          <SettingsField
            layout="row"
            label={t('settings.composerMarkdown')}
            description={t('settings.composerMarkdownHelp')}
          >
            <Switch
              checked={settings.appearance.composerMarkdown}
              onCheckedChange={(enabled) => void onComposerMarkdownChange(enabled)}
              aria-label={t('settings.composerMarkdown')}
            />
          </SettingsField>
        </div>
      </SettingsSection>
    </section>
  );
};
