import React from 'react';
import type { AppSettings, AppTheme, FontScale } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { PersonalizationSettings } from './PersonalizationSettings';
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
  globalInstructionsDraft: string;
  onGlobalInstructionsDraftChange: (value: string) => void;
  onSavePersonalization: () => void | Promise<void>;
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
  globalInstructionsDraft,
  onGlobalInstructionsDraftChange,
  onSavePersonalization,
  t,
}) => {
  return (
    <section className="settings-page settings-page-general">
      <div className="settings-general-grid settings-general-grid--rows">
        <div className="settings-general-top-row">
          <ProfileSettings
            accountDraft={accountDraft}
            onAccountDraftChange={onAccountDraftChange}
            onAvatarSelect={onAvatarSelect}
            onSave={onAccountSave}
            t={t}
          />

          <div className="settings-section settings-appearance-section settings-appearance-section--compact">
            <div className="settings-section-header">
              <div>
                <div className="settings-section-title">{t('settings.appearance')}</div>
                <div className="settings-section-subtitle">{t('settings.appearanceHint')}</div>
              </div>
            </div>
            <div className="settings-preference-list settings-appearance-list">
              <div className="settings-preference-row">
                <div className="settings-preference-copy settings-option-block">
                  <div className="settings-field-label">{t('userMenu.theme')}</div>
                  <div className="settings-help-text">{t('settings.themeHint')}</div>
                </div>
                <div className="user-menu-pill-group settings-inline-pills settings-choice-group">
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

              <div className="settings-preference-row">
                <div className="settings-preference-copy settings-option-block">
                  <div className="settings-field-label">{t('userMenu.language')}</div>
                  <div className="settings-help-text">{t('settings.languageHint')}</div>
                </div>
                <div className="user-menu-pill-group settings-inline-pills settings-choice-group">
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

              <div className="settings-preference-row">
                <div className="settings-preference-copy settings-option-block">
                  <div className="settings-field-label">{t('userMenu.fontScale')}</div>
                  <div className="settings-help-text">{t('settings.fontScaleHint')}</div>
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
            </div>
          </div>
        </div>
        <PersonalizationSettings
          embedded
          globalInstructionsDraft={globalInstructionsDraft}
          onGlobalInstructionsDraftChange={onGlobalInstructionsDraftChange}
          onSavePersonalization={onSavePersonalization}
          t={t}
        />
      </div>
    </section>
  );
};
