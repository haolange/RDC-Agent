import React from 'react';
import { Button } from '../../../../ui/Button';
import { Input } from '../../../../ui/Input';
import { ProfileAvatar } from '../../../../patterns/ProfileAvatar';
import { SettingsField, SettingsSection, useSettingsAutosave, type SettingsAutosaveStatus } from '../parts';
import type { useI18n } from '../../../../i18n';
import type { AppSettings } from '@shared/types/settings';

type Translate = ReturnType<typeof useI18n>['t'];
interface ProfileSettingsProps {
  accountDraft: AppSettings['profile'];
  /** The saved profile; the draft autosaves while it differs. */
  savedProfile: AppSettings['profile'];
  onAccountDraftChange: React.Dispatch<React.SetStateAction<AppSettings['profile']>>;
  onAvatarSelect: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  t: Translate;
}

function statusText(status: SettingsAutosaveStatus, t: Translate): string {
  if (status === 'saving') return t('settings.saving');
  if (status === 'saved') return t('settings.profileSaved');
  if (status === 'error') return t('settings.profileSaveFailed');
  return '';
}

export const ProfileSettings: React.FC<ProfileSettingsProps> = ({
  accountDraft,
  savedProfile,
  onAccountDraftChange,
  onAvatarSelect,
  onSave,
  t,
}) => {
  // A chosen avatar and an edited nickname both persist without a separate save step.
  const pending = accountDraft.nickname !== savedProfile.nickname || accountDraft.avatarPath !== savedProfile.avatarPath;
  const { status, flush } = useSettingsAutosave(`${accountDraft.nickname}\u0000${accountDraft.avatarPath ?? ''}`, pending, onSave);

  const nicknameId = 'settings-profile-nickname';

  return (
    <SettingsSection
      title={t('settings.profile')}
      className="settings-profile-section"
      data-settings-search="profile"
    >
      <div className="settings-profile-row">
        <div className="settings-profile-avatar-group">
          <ProfileAvatar
            className="settings-account-avatar"
            fallbackClassName="settings-account-avatar-fallback"
            avatarPath={accountDraft.avatarPath}
            nickname={accountDraft.nickname}
          />
          <Button variant="secondary" size="sm" onClick={() => void onAvatarSelect()}>
            {t('settings.changeAvatar')}
          </Button>
        </div>
        <SettingsField label={t('settings.nickname')} htmlFor={nicknameId} className="settings-profile-nickname">
          <Input
            id={nicknameId}
            value={accountDraft.nickname}
            onChange={(event) => onAccountDraftChange((current) => ({ ...current, nickname: event.target.value }))}
            onBlur={flush}
          />
        </SettingsField>
        <span className="settings-save-status settings-profile-status" role="status" data-status={status}>{statusText(status, t)}</span>
      </div>
    </SettingsSection>
  );
};
