import React from 'react';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
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
      <div className="settings-general-grid settings-general-grid--rows">
        <div className="settings-general-top-row">
          <ProfileSettings
            accountDraft={accountDraft}
            onAccountDraftChange={onAccountDraftChange}
            onAvatarSelect={onAvatarSelect}
            onSave={onAccountSave}
            t={t}
          />

          <SettingsSection title={t('userMenu.language')} className="settings-appearance-section settings-appearance-section--compact">
            <SettingsField label={t('userMenu.language')} search="language" layout="row">
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
                  English
                </Pill>
              </div>
            </SettingsField>
          </SettingsSection>
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
