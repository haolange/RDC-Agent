import React, { useState } from 'react';
import type { AppSettings } from '@shared/types/settings';
import { Button } from '../../../../ui/Button';
import { Input } from '../../../../ui/Input';
import { ProfileAvatar } from '../../../../patterns/ProfileAvatar';
import type { useI18n } from '../../../../i18n';
import { SettingsField, SettingsSection } from '../parts';

type Translate = ReturnType<typeof useI18n>['t'];
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface ProfileSettingsProps {
  accountDraft: AppSettings['profile'];
  onAccountDraftChange: React.Dispatch<React.SetStateAction<AppSettings['profile']>>;
  onAvatarSelect: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  t: Translate;
}

function statusText(status: SaveStatus, t: Translate): string {
  if (status === 'saving') return t('settings.saving');
  if (status === 'saved') return t('settings.profileSaved');
  if (status === 'error') return t('settings.profileSaveFailed');
  return '';
}

export const ProfileSettings: React.FC<ProfileSettingsProps> = ({
  accountDraft,
  onAccountDraftChange,
  onAvatarSelect,
  onSave,
  t,
}) => {
  const [status, setStatus] = useState<SaveStatus>('idle');

  const save = async () => {
    setStatus('saving');
    try {
      await onSave();
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  const nicknameId = 'settings-profile-nickname';

  return (
    <SettingsSection
      title={t('settings.profile')}
      description={t('settings.profileHint')}
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
            onChange={(event) => {
              setStatus('idle');
              onAccountDraftChange((current) => ({ ...current, nickname: event.target.value }));
            }}
          />
        </SettingsField>
        <div className="settings-profile-actions">
          <span className="settings-save-status" role="status" data-status={status}>
            {statusText(status, t)}
          </span>
          <Button variant="secondary" size="sm" onClick={() => void save()} disabled={status === 'saving'}>
            {t('settings.saveProfile')}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
};
