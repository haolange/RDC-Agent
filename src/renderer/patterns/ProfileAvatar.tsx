import React, { useState } from 'react';
import { useElectronApi } from '../hooks/useElectronApi';
import { useAsyncValue } from '../lib/useAsyncValue';

import './ProfileAvatar.css';

interface ProfileAvatarProps {
  avatarPath?: string;
  nickname: string;
  className: string;
  fallbackClassName?: string;
  alt?: string;
}

const getInitials = (nickname: string): string => {
  const normalized = nickname.trim();
  return (normalized || 'RD').slice(0, 2).toUpperCase();
};

export const ProfileAvatar: React.FC<ProfileAvatarProps> = ({
  avatarPath,
  nickname,
  className,
  fallbackClassName,
  alt = 'avatar',
}) => {
  const electronAPI = useElectronApi();
  const normalizedAvatarPath = avatarPath?.trim() ?? '';
  const avatar = useAsyncValue(
    electronAPI && normalizedAvatarPath ? normalizedAvatarPath : null,
    async () => (await electronAPI?.appShell.getAvatarDataUrl(normalizedAvatarPath)) ?? null,
  );
  // An image the browser could not decode falls back to the initials until the avatar changes.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const loaded = avatar.status === 'ready' ? avatar.value : null;
  const avatarDataUrl = loaded && loaded !== brokenUrl ? loaded : null;

  if (avatarDataUrl) {
    return (
      <img
        className={`${className} profile-avatar-image`}
        src={avatarDataUrl}
        alt={alt}
        data-avatar-kind="image"
        onError={() => setBrokenUrl(avatarDataUrl)}
      />
    );
  }

  return (
    <span
      className={[className, fallbackClassName, 'profile-avatar-fallback'].filter(Boolean).join(' ')}
      data-avatar-kind="fallback"
    >
      {getInitials(nickname)}
    </span>
  );
};

export default ProfileAvatar;
