import React from 'react';
import type { AppSettings } from '@shared/types/settings';
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
      <div>
        <div className="settings-section-title">{t('settings.profile')}</div>
        <div className="settings-section-subtitle">{t('settings.profileHint')}</div>
      </div>
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
          <button type="button" className="button button-secondary" onClick={() => void onAvatarSelect()}>
            {t('settings.uploadAvatar')}
          </button>
          <button type="button" className="button button-primary" onClick={() => void onSave()}>
            {t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  </div>
);
