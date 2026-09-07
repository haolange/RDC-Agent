import React from 'react';
import type { AppSettings } from '@shared/types/settings';
import { Button } from '../../../../ui/Button';
import { Input } from '../../../../ui/Input';
import { ProfileAvatar } from '../../../../patterns/ProfileAvatar';
import type { useI18n } from '../../../../i18n';
import { SettingsField, SettingsSection } from '../parts';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProfileSettingsProps {
  accountDraft: AppSettings['profile'];
  onAccountDraftChange: React.Dispatch<React.SetStateAction<AppSettings['profile']>>;
  onAvatarSelect: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  t: Translate;
}

export const ProfileSettings: React.FC<ProfileSettingsProps> = ({
  accountDraft,
  onAccountDraftChange,
  onAvatarSelect,
  onSave,
  t,
}) => (
  <SettingsSection title={t('settings.profile')} className="settings-profile-section">
    <div className="settings-profile-row">
      <div className="settings-account-avatar-shell">
        <ProfileAvatar
          className="settings-account-avatar"
          fallbackClassName="settings-account-avatar-fallback"
          avatarPath={accountDraft.avatarPath}
          nickname={accountDraft.nickname}
        />
      </div>
      <div className="settings-profile-fields">
        <SettingsField label={t('settings.nickname')}>
          <Input
            value={accountDraft.nickname}
            onChange={(event) => onAccountDraftChange((current) => ({ ...current, nickname: event.target.value }))}
          />
        </SettingsField>
        <div className="settings-profile-actions">
          <Button variant="secondary" size="sm" onClick={() => void onAvatarSelect()}>
            {t('settings.uploadAvatar')}
          </Button>
          <Button variant="primary" size="sm" onClick={() => void onSave()}>
            {t('settings.save')}
          </Button>
        </div>
      </div>
    </div>
  </SettingsSection>
);
