import React, { useState } from 'react';
import { useResolvedTheme } from '../../../../lib/useResolvedTheme';
import { Button } from '../../../../ui/Button';
import { Switch } from '../../../../ui/Switch';
import { Tabs } from '../../../../ui/Tabs';
import { SettingsField, SettingsSection } from '../parts';
import { AppearanceChromePreview } from './AppearanceChromePreview';
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

export const AppearanceSettings: React.FC<AppearanceSettingsProps> = ({
  settings,
  onThemeChange,
  onFontScaleChange,
  onComposerMarkdownChange,
  onChromeThemeChange,
  t,
}) => {
  const resolvedTheme = useResolvedTheme();
  const [editing, setEditing] = useState<ThemeVariant>(resolvedTheme);

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

      <SettingsSection variant="rows" title={t('settings.appearanceThemeEditor')}>
        <div className="appearance-theme-previews" role="group" aria-label={t('settings.appearanceThemeEditor')}>
          {(['light', 'dark'] as const).map((variant) => (
            <Button key={variant} variant="ghost" className="appearance-theme-preview-button"
              aria-pressed={editing === variant} onClick={() => setEditing(variant)}>
              <span>{t(variant === 'light' ? 'settings.appearanceLightTheme' : 'settings.appearanceDarkTheme')}</span>
              <AppearanceChromePreview chrome={settings.appearance.chromeThemes[variant]} variant={variant} t={t}
                data-testid={`appearance-preview-${variant}`} />
            </Button>
          ))}
        </div>
        <ChromeThemeCard key={editing} variant={editing} chrome={settings.appearance.chromeThemes[editing]} t={t}
          onChange={(chrome) => void onChromeThemeChange(editing, chrome)} />
      </SettingsSection>

      <SettingsSection variant="rows" title={t('settings.appearancePreferences')}>
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
      </SettingsSection>
    </section>
  );
};
