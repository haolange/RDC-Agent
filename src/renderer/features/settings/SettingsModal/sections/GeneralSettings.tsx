import { Button } from '../../../../ui/Button';
import React from 'react';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { Icon } from '../../../../ui/Icon';
import { Pill } from '../../../../ui/Pill';
import { SettingsField, SettingsSection } from '../parts';
import { PersonalizationSettings } from './PersonalizationSettings';
import { ProfileSettings } from './ProfileSettings';

type Translate = ReturnType<typeof useI18n>['t'];

interface GeneralSettingsProps {
  settings: AppSettings;
  accountDraft: AppSettings['profile'];
  onAccountDraftChange: React.Dispatch<React.SetStateAction<AppSettings['profile']>>;
  onAvatarSelect: () => void | Promise<void>;
  onAccountSave: () => void | Promise<void>;
  onLanguageChange: (language: AppSettings['appearance']['language']) => void | Promise<void>;
  globalInstructionsDraft: string;
  onGlobalInstructionsDraftChange: (value: string) => void;
  onSavePersonalization: () => void | Promise<void>;
  onOpenResourceDiagnostics: () => void;
  t: Translate;
}

export const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  settings,
  accountDraft,
  onAccountDraftChange,
  onAvatarSelect,
  onAccountSave,
  onLanguageChange,
  globalInstructionsDraft,
  onGlobalInstructionsDraftChange,
  onSavePersonalization,
  onOpenResourceDiagnostics,
  t,
}) => {
  return (
    <section className="settings-page settings-page-general" data-settings-search="general">
      <div className="settings-general-grid">
        <ProfileSettings
          accountDraft={accountDraft}
          onAccountDraftChange={onAccountDraftChange}
          onAvatarSelect={onAvatarSelect}
          onSave={onAccountSave}
          t={t}
        />

        <SettingsSection
          title={t('settings.appearancePreferences')}
          description={t('settings.languagePreferenceHint')}
          className="settings-language-section"
          data-settings-search="language"
        >
          <SettingsField layout="row" label={t('userMenu.language')} search="language">
            <div className="settings-choice-group" role="group" aria-label={t('userMenu.language')}>
              <Pill
                selected={settings.appearance.language === 'zh-CN'}
                onClick={() => void onLanguageChange('zh-CN')}
              >
                {t('language.zh')}
              </Pill>
              <Pill
                selected={settings.appearance.language === 'en'}
                onClick={() => void onLanguageChange('en')}
              >
                {t('language.en')}
              </Pill>
            </div>
          </SettingsField>
        </SettingsSection>
        <PersonalizationSettings
          globalInstructionsDraft={globalInstructionsDraft}
          onGlobalInstructionsDraftChange={onGlobalInstructionsDraftChange}
          onSavePersonalization={onSavePersonalization}
          t={t}
        />
        <Button variant="ghost" size="sm"
          type="button"
          className="settings-disclosure-row"
          data-settings-search="resource-diagnostics"
          data-testid="settings-open-resource-diagnostics"
          onClick={onOpenResourceDiagnostics}
        >
          <Icon name="chevron-right" size={14} className="settings-disclosure-row-icon" />
          <span className="settings-disclosure-row-label">{t('settings.resourceDiagnosticsTitle')}</span>
          <span className="settings-disclosure-row-hint">{t('settings.resourceDiagnosticsOpen')}</span>
        </Button>
      </div>
    </section>
  );
};
