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
import { Tabs } from '../../../../ui/Tabs';
import { SettingsField, SettingsSection } from '../parts';
import { ChromeThemeCard } from './AppearanceChromeParts';

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
      <Tabs
        className="appearance-mode-tabs"
        variant="segmented"
        label={t('userMenu.theme')}
        value={settings.appearance.theme}
        onChange={(mode) => void onThemeChange(mode as AppTheme)}
        tabs={(['system', 'light', 'dark'] as AppTheme[]).map((mode) => ({
          id: mode,
          label: t(`theme.${mode}`),
        }))}
      />

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
            <Tabs
              variant="segmented"
              label={t('settings.appearanceReduceMotion')}
              value={settings.appearance.reduceMotion}
              onChange={(value) => void onReduceMotionChange(value as ReduceMotionPreference)}
              tabs={(['system', 'on', 'off'] as ReduceMotionPreference[]).map((value) => ({
                id: value,
                label: t(`settings.appearanceReduceMotion.${value}`),
              }))}
            />
          </SettingsField>

          <SettingsField layout="row" label={t('userMenu.fontScale')} search="font-scale">
            <Tabs
              variant="segmented"
              label={t('userMenu.fontScale')}
              value={settings.appearance.fontScale}
              onChange={(value) => void onFontScaleChange(value as FontScale)}
              tabs={(['small', 'medium', 'large'] as FontScale[]).map((fontScale) => ({
                id: fontScale,
                label: t(`font.${fontScale}`),
              }))}
            />
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
