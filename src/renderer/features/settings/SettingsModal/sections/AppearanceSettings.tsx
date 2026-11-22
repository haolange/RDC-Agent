import React from 'react';
import { Switch } from '../../../../ui/Switch';
import { Tabs } from '../../../../ui/Tabs';
import { SettingsField, SettingsSection } from '../parts';
import { ChromeThemeCard } from './AppearanceChromeParts';
import type { useI18n } from '../../../../i18n';
import type {
  AppSettings,
  AppTheme,
  FontScale,
  ThemeChromeConfig,
  ThemeVariant,
} from '@shared/types/settings';

type Translate = ReturnType<typeof useI18n>['t'];

interface AppearanceSettingsProps {
  settings: AppSettings;
  onThemeChange: (theme: AppTheme) => void | Promise<void>;
  onFontScaleChange: (fontScale: FontScale) => void | Promise<void>;
  onComposerMarkdownChange: (enabled: boolean) => void | Promise<void>;
  onChromeThemeChange: (variant: ThemeVariant, chrome: Partial<ThemeChromeConfig>) => void | Promise<void>;
  t: Translate;
}

/**
 * The theme switch, then both themes side by side, each with its live preview and its own editor, always open;
 * display preferences follow.
 */
export const AppearanceSettings: React.FC<AppearanceSettingsProps> = ({
  settings,
  onThemeChange,
  onFontScaleChange,
  onComposerMarkdownChange,
  onChromeThemeChange,
  t,
}) => (
  <section className="settings-page settings-page-appearance" data-testid="settings-appearance-page" data-settings-search="appearance">
    <Tabs
      className="appearance-mode-tabs"
      variant="segmented"
      label={t('userMenu.theme')}
      value={settings.appearance.theme}
      onChange={(mode) => void onThemeChange(mode as AppTheme)}
      tabs={(['system', 'light', 'dark'] as AppTheme[]).map((mode) => ({ id: mode, label: t(`theme.${mode}`) }))}
    />

    <div className="appearance-theme-editors">
      {(['light', 'dark'] as ThemeVariant[]).map((variant) => (
        <ChromeThemeCard key={variant} variant={variant} chrome={settings.appearance.chromeThemes[variant]} t={t}
          onChange={(chrome) => void onChromeThemeChange(variant, chrome)} />
      ))}
    </div>

    <SettingsSection title={t('settings.appearancePreferences')} className="appearance-preferences">
      <div className="settings-preference-list settings-appearance-toggles">
        <SettingsField layout="row" label={t('userMenu.fontScale')} description={t('settings.appearanceFontScaleHelp')} search="font-scale">
          <Tabs
            variant="segmented"
            label={t('userMenu.fontScale')}
            value={settings.appearance.fontScale}
            onChange={(value) => void onFontScaleChange(value as FontScale)}
            tabs={(['small', 'medium', 'large'] as FontScale[]).map((fontScale) => ({ id: fontScale, label: t(`font.${fontScale}`) }))}
          />
        </SettingsField>
        <SettingsField layout="row" label={t('settings.composerMarkdown')} description={t('settings.composerMarkdownHelp')}>
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
