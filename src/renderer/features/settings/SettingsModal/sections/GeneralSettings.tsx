import React from 'react';
import { useAppSettingsStore } from '../../../../stores/appSettingsStore';
import { Tabs } from '../../../../ui/Tabs';
import { SettingsField, SettingsSection } from '../parts';
import { useI18n } from '../../../../i18n';
import { PersonalizationSettings } from './PersonalizationSettings';
import { ProfileSettings } from './ProfileSettings';
import type { AppSettings } from '@shared/types/settings';

function WorkProcessPreview({ latest }: { latest?: boolean }) {
  return (
    <span className={`work-process-choice-preview${latest ? ' is-following' : ''}`} aria-hidden="true">
      <span /><span /><span /><span />
    </span>
  );
}

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
}) => {
  const { t } = useI18n();
  const onWorkProcessExpansionChange = useAppSettingsStore((state) => state.setWorkProcessExpansion);
  return (
    <section className="settings-page settings-page-general" data-settings-search="general">
      <div className="settings-general-grid">
        <ProfileSettings
          accountDraft={accountDraft}
          savedProfile={settings.profile}
          onAccountDraftChange={onAccountDraftChange}
          onAvatarSelect={onAvatarSelect}
          onSave={onAccountSave}
        />

        <SettingsSection variant="rows"
          title={t('settings.appearancePreferences')}
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
          <SettingsField layout="row" label={t('settings.workProcessExpansion')} search="work-process-expansion"
            description={t(settings.appearance.workProcessExpansion === 'latest'
              ? 'settings.workProcessExpansionLatestHint' : 'settings.workProcessExpansionAllHint')}>
            <Tabs className="work-process-choice" variant="segmented" label={t('settings.workProcessExpansion')}
              value={settings.appearance.workProcessExpansion}
              tabs={[
                { id: 'latest', label: t('settings.workProcessExpansionLatest'), icon: <WorkProcessPreview latest />,
                  description: t('settings.workProcessExpansionLatestHint') },
                { id: 'all', label: t('settings.workProcessExpansionAll'), icon: <WorkProcessPreview />,
                  description: t('settings.workProcessExpansionAllHint') },
              ]}
              onChange={(expansion) => {
                if (expansion === 'latest' || expansion === 'all') void onWorkProcessExpansionChange(expansion);
              }} />
          </SettingsField>
        </SettingsSection>
        <PersonalizationSettings
          globalInstructionsDraft={globalInstructionsDraft}
          savedGlobalInstructions={settings.agents.globalInstructions}
          onGlobalInstructionsDraftChange={onGlobalInstructionsDraftChange}
          onSavePersonalization={onSavePersonalization}
        />
      </div>
    </section>
  );
};
