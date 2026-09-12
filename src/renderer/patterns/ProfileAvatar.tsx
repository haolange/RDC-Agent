import React, { useEffect, useState } from 'react';
import { useElectronApi } from '../hooks/useElectronApi';

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
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAvatarDataUrl(null);

    if (!normalizedAvatarPath) {
      return () => {
        cancelled = true;
      };
    }

    void electronAPI?.appShell.getAvatarDataUrl(normalizedAvatarPath)
      .then((dataUrl) => {
        if (!cancelled) {
          setAvatarDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvatarDataUrl(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [electronAPI, normalizedAvatarPath]);

  if (avatarDataUrl) {
    return (
      <img
        className={`${className} profile-avatar-image`}
        src={avatarDataUrl}
        alt={alt}
        data-avatar-kind="image"
        onError={() => setAvatarDataUrl(null)}
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
