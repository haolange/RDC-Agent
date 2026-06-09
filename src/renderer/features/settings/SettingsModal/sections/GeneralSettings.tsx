import React from 'react';
import type { AppSettings, AppTheme, FontScale } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { ProfileSettings } from './ProfileSettings';

type Translate = ReturnType<typeof useI18n>['t'];

interface GeneralSettingsProps {
  settings: AppSettings;
  accountDraft: AppSettings['profile'];
  onAccountDraftChange: React.Dispatch<React.SetStateAction<AppSettings['profile']>>;
  onAvatarSelect: () => void | Promise<void>;
  onAccountSave: () => void | Promise<void>;
  onThemeChange: (theme: AppTheme) => void | Promise<void>;
  onLanguageChange: (language: AppSettings['appearance']['language']) => void | Promise<void>;
  onFontScaleChange: (fontScale: FontScale) => void | Promise<void>;
  t: Translate;
}

export const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  settings,
  accountDraft,
  onAccountDraftChange,
  onAvatarSelect,
  onAccountSave,
  onThemeChange,
  onLanguageChange,
  onFontScaleChange,
  t,
}) => {
  const configuredProviderCount = settings.llm.providers.filter(
    (provider) => provider.enabled && provider.isConfigured,
  ).length;
  const enabledModelCount = settings.llm.providers.reduce(
    (count, provider) => count + provider.models.filter((model) => model.enabled).length,
    0,
  );
  const workspaceRoot = settings.workspace.rootPath || settings.paths.defaultWorkspaceRoot;

  return (
    <section className="settings-page settings-page-general">
      <div className="settings-general-grid">
        <ProfileSettings
          accountDraft={accountDraft}
          onAccountDraftChange={onAccountDraftChange}
          onAvatarSelect={onAvatarSelect}
          onSave={onAccountSave}
          t={t}
        />

        <div className="settings-section settings-appearance-section">
          <div className="settings-section-header">
            <div>
              <div className="settings-section-title">{t('settings.appearance')}</div>
              <div className="settings-section-subtitle">{t('settings.appearanceHint')}</div>
            </div>
          </div>
          <div className="settings-option-block">
            <div className="settings-field-label">{t('userMenu.theme')}</div>
            <div className="user-menu-pill-group settings-inline-pills">
              {(['dark', 'light', 'system'] as AppTheme[]).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={`user-menu-pill ${settings.appearance.theme === theme ? 'active' : ''}`}
                  onClick={() => void onThemeChange(theme)}
                >
                  {t(`theme.${theme}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-option-block">
            <div className="settings-field-label">{t('userMenu.language')}</div>
            <div className="user-menu-pill-group settings-inline-pills">
              <button
                type="button"
                className={`user-menu-pill ${settings.appearance.language === 'zh-CN' ? 'active' : ''}`}
                onClick={() => void onLanguageChange('zh-CN')}
              >
                {t('language.zh')}
              </button>
              <button
                type="button"
                className={`user-menu-pill ${settings.appearance.language === 'en' ? 'active' : ''}`}
                onClick={() => void onLanguageChange('en')}
              >
                English
              </button>
            </div>
          </div>

          <div className="settings-option-block">
            <div className="settings-field-label">{t('userMenu.fontScale')}</div>
            <div className="user-menu-pill-group settings-inline-pills">
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
        </div>
      </div>

      <div className="settings-section settings-environment-overview">
        <div className="settings-section-header">
          <div>
            <div className="settings-section-title">{t('settings.localEnvironment')}</div>
            <div className="settings-section-subtitle">{t('settings.localEnvironmentHint')}</div>
          </div>
        </div>
        <div className="settings-overview-grid">
          <div className="settings-overview-item">
            <span>{t('settings.workspaceRoot')}</span>
            <strong title={workspaceRoot}>{workspaceRoot || t('settings.unset')}</strong>
          </div>
          <div className="settings-overview-item">
            <span>{t('settings.connectedProviders')}</span>
            <strong>{t('settings.providerModelSummary', {
              providers: String(configuredProviderCount),
              models: String(enabledModelCount),
            })}</strong>
          </div>
          <div className="settings-overview-item">
            <span>{t('settings.rdxCliInvoker')}</span>
            <strong>{settings.tooling.rdxCli.enabled ? t('settings.enabled') : t('settings.disabled')}</strong>
          </div>
        </div>
      </div>
    </section>
  );
};
