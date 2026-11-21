import React, { useState } from 'react';
import { Switch } from '../../../../ui/Switch';
import { Tabs } from '../../../../ui/Tabs';
import { SettingsField, SettingsSection } from '../parts';
import { ChromeThemeCard } from './AppearanceChromeParts';
import { AppearancePresetRow } from './AppearancePresetRow';
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
 * One theme switch (system / light / dark), then one preset row per mode; 自定义 opens that mode's editor in place.
 * Display preferences (font size, Markdown input) follow.
 */
export const AppearanceSettings: React.FC<AppearanceSettingsProps> = ({
  settings,
  onThemeChange,
  onFontScaleChange,
  onComposerMarkdownChange,
  onChromeThemeChange,
  t,
}) => {
  const [editing, setEditing] = useState<ThemeVariant | null>(null);
  return (
    <section className="settings-page settings-page-appearance" data-testid="settings-appearance-page" data-settings-search="appearance">
      <SettingsField layout="row" label={t('userMenu.theme')} search="theme">
        <Tabs
          className="appearance-mode-tabs"
          variant="segmented"
          label={t('userMenu.theme')}
          value={settings.appearance.theme}
          onChange={(mode) => void onThemeChange(mode as AppTheme)}
          tabs={(['system', 'light', 'dark'] as AppTheme[]).map((mode) => ({ id: mode, label: t(`theme.${mode}`) }))}
        />
      </SettingsField>

      <div className="appearance-preset-rows">
        {(['light', 'dark'] as ThemeVariant[]).map((variant) => (
          <React.Fragment key={variant}>
            <AppearancePresetRow variant={variant} chrome={settings.appearance.chromeThemes[variant]} editing={editing === variant} t={t}
              onChange={(chrome) => void onChromeThemeChange(variant, chrome)}
              onEdit={() => setEditing((current) => (current === variant ? null : variant))} />
            {editing === variant ? (
              <ChromeThemeCard key={variant} variant={variant} chrome={settings.appearance.chromeThemes[variant]} t={t}
                onChange={(chrome) => void onChromeThemeChange(variant, chrome)} />
            ) : null}
          </React.Fragment>
        ))}
      </div>

      <SettingsSection title={t('settings.appearanceDisplay')} className="appearance-preferences">
        <div className="settings-preference-list settings-appearance-toggles">
          <SettingsField layout="row" label={t('userMenu.fontScale')} help={t('settings.appearanceFontScaleHelp')} search="font-scale">
            <Tabs
              variant="segmented"
              label={t('userMenu.fontScale')}
              value={settings.appearance.fontScale}
              onChange={(value) => void onFontScaleChange(value as FontScale)}
              tabs={(['small', 'medium', 'large'] as FontScale[]).map((fontScale) => ({ id: fontScale, label: t(`font.${fontScale}`) }))}
            />
          </SettingsField>
          <SettingsField layout="row" label={t('settings.composerMarkdown')} help={t('settings.composerMarkdownHelp')}>
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
