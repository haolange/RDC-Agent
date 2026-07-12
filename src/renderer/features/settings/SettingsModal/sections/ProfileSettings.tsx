import React from 'react';
import type { AppSettings } from '@shared/types/settings';
import { Button } from '../../../../ui/Button';
import { ProfileAvatar } from '../../../../ui/ProfileAvatar';
import type { useI18n } from '../../../../i18n';

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
  <div className="settings-section settings-profile-section">
    <div className="settings-section-header">
      <div className="settings-section-title">{t('settings.profile')}</div>
    </div>

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
        <label className="settings-field">
          <span className="settings-field-label">{t('settings.nickname')}</span>
          <input
            className="input"
            value={accountDraft.nickname}
            onChange={(event) => onAccountDraftChange((current) => ({ ...current, nickname: event.target.value }))}
          />
        </label>
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
  </div>
);
