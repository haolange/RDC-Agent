import React from 'react';
import { ProfileAvatar } from '../../../../patterns/ProfileAvatar';
import { SettingsSaveMark, SettingsSection, useSettingsAutosave } from '../parts';
import { useI18n } from '../../../../i18n';
import { PlainButton } from '../../../../ui/PlainButton';
import type { AppSettings } from '@shared/types/settings';

interface ProfileSettingsProps {
  accountDraft: AppSettings['profile'];
  /** The saved profile; the draft autosaves while it differs. */
  savedProfile: AppSettings['profile'];
  onAccountDraftChange: React.Dispatch<React.SetStateAction<AppSettings['profile']>>;
  onAvatarSelect: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
}

/** One row: the avatar (click to change it) and the nickname edited in place; both save on their own. */
export const ProfileSettings: React.FC<ProfileSettingsProps> = ({
  accountDraft,
  savedProfile,
  onAccountDraftChange,
  onAvatarSelect,
  onSave,
}) => {
  const { t } = useI18n();
  const pending =
    accountDraft.nickname !== savedProfile.nickname || accountDraft.avatarPath !== savedProfile.avatarPath;
  const { status, flush } = useSettingsAutosave(
    `${accountDraft.nickname}\u0000${accountDraft.avatarPath ?? ''}`,
    pending,
    onSave,
  );

  return (
    <SettingsSection
      variant="rows"
      title={t('settings.profile')}
      className="settings-profile-section"
      data-settings-search="profile"
    >
      <div className="settings-profile-row">
        <PlainButton
          className="settings-profile-avatar-button"
          aria-label={t('settings.changeAvatar')}
          data-tooltip={t('settings.changeAvatar')}
          onClick={() => void onAvatarSelect()}
        >
          <ProfileAvatar
            className="settings-account-avatar"
            fallbackClassName="settings-account-avatar-fallback"
            avatarPath={accountDraft.avatarPath}
            nickname={accountDraft.nickname}
          />
        </PlainButton>
        <input
          className="settings-profile-nickname"
          aria-label={t('settings.nickname')}
          placeholder={t('settings.nickname')}
          value={accountDraft.nickname}
          onChange={(event) => onAccountDraftChange((current) => ({ ...current, nickname: event.target.value }))}
          onBlur={flush}
        />
        <SettingsSaveMark
          status={status}
          savingLabel={t('settings.saving')}
          savedLabel={t('settings.profileSaved')}
          errorLabel={t('settings.profileSaveFailed')}
          onRetry={flush}
          retryLabel={t('settings.retry')}
        />
      </div>
    </SettingsSection>
  );
};
