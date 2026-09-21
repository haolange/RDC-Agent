import React from 'react';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { Tabs } from '../../../../ui/Tabs';
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
            <Tabs variant="segmented" label={t('userMenu.language')}
              value={settings.appearance.language}
              tabs={[{ id: 'zh-CN', label: t('language.zh') }, { id: 'en', label: t('language.en') }]}
              onChange={(language) => {
                if (language === 'zh-CN' || language === 'en') void onLanguageChange(language);
              }} />
          </SettingsField>
        </SettingsSection>
        <PersonalizationSettings
          globalInstructionsDraft={globalInstructionsDraft}
          onGlobalInstructionsDraftChange={onGlobalInstructionsDraftChange}
          onSavePersonalization={onSavePersonalization}
          t={t}
        />
      </div>
    </section>
  );
};
