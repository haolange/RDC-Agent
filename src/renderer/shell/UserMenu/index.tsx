import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppLanguage, AppSettings, AppTheme, FontScale } from '@shared/types/settings';
import { useI18n } from '../../i18n';
import { useDynStyle } from '../../lib/useDynStyle';
import { ProfileAvatar } from '../../patterns/ProfileAvatar';
import './UserMenu.css';

interface UserMenuProps {
  anchorRect: DOMRect | null;
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onOpenSettings: () => void;
  onThemeChange: (theme: AppTheme) => void;
  onLanguageChange: (language: AppLanguage) => void;
  onFontScaleChange: (fontScale: FontScale) => void;
}

const MENU_WIDTH = 332;
const VIEWPORT_MARGIN = 16;
const ANCHOR_GAP = 12;

const clamp = (value: number, min: number, max: number): number => {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
};

export const UserMenu: React.FC<UserMenuProps> = ({
  anchorRect,
  open,
  settings,
  onClose,
  onOpenSettings,
  onThemeChange,
  onLanguageChange,
  onFontScaleChange,
}) => {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN, ready: false });

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  const updatePosition = useCallback(() => {
    const menuElement = menuRef.current;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuWidth = menuElement?.offsetWidth ?? MENU_WIDTH;
    const menuHeight = menuElement?.offsetHeight ?? 360;

    if (!anchorRect) {
      setPosition({
        left: VIEWPORT_MARGIN,
        top: clamp(
          viewportHeight - menuHeight - VIEWPORT_MARGIN,
          VIEWPORT_MARGIN,
          viewportHeight - menuHeight - VIEWPORT_MARGIN,
        ),
        ready: true,
      });
      return;
    }

    const maxLeft = viewportWidth - menuWidth - VIEWPORT_MARGIN;
    const maxTop = viewportHeight - menuHeight - VIEWPORT_MARGIN;
    const left = clamp(anchorRect.left, VIEWPORT_MARGIN, maxLeft);
    const preferredTop = anchorRect.top - menuHeight - ANCHOR_GAP;
    const fallbackTop = anchorRect.bottom + ANCHOR_GAP;
    const topCandidate = preferredTop >= VIEWPORT_MARGIN ? preferredTop : fallbackTop;
    const top = clamp(topCandidate, VIEWPORT_MARGIN, maxTop);

    setPosition({ left, top, ready: true });
  }, [anchorRect]);

  useEffect(() => {
    if (!open) {
      setPosition((current) => ({ ...current, ready: false }));
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    updatePosition();

    const handleViewportChange = () => {
      updatePosition();
    };

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => updatePosition())
      : null;

    if (menuRef.current && resizeObserver) {
      resizeObserver.observe(menuRef.current);
    }

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [
    open,
    updatePosition,
    settings.appearance.fontScale,
    settings.appearance.language,
    settings.profile.nickname,
  ]);

  const menuDynStyle = useDynStyle({
    left: `${position.left}px`,
    top: `${position.top}px`,
    visibility: position.ready ? 'visible' : 'hidden',
  });

  if (!open) return null;

  return createPortal(
    <div className="user-menu-backdrop">
      <div
        ref={menuRef}
        className="user-menu-popover visible"
        data-testid="sidebar-user-menu"
        role="dialog"
        aria-modal="false"
        aria-label={t('sidebar.userSettings')}
        {...menuDynStyle}
      >
        <div className="user-menu-header">
          <ProfileAvatar
            className="user-menu-avatar"
            avatarPath={settings.profile.avatarPath}
            nickname={settings.profile.nickname}
          />
          <div className="user-menu-header-copy">
            <div className="user-menu-name">{settings.profile.nickname}</div>
          </div>
        </div>

        <div className="user-menu-section">
          <div className="user-menu-section-label">{t('userMenu.language')}</div>
          <div className="user-menu-pill-group">
            <button
              type="button"
              className={`user-menu-pill ${settings.appearance.language === 'zh-CN' ? 'is-selected' : ''}`}
              onClick={() => void onLanguageChange('zh-CN')}
            >
              {t('language.zh')}
            </button>
            <button
              type="button"
              className={`user-menu-pill ${settings.appearance.language === 'en' ? 'is-selected' : ''}`}
              onClick={() => void onLanguageChange('en')}
            >
              {t('language.en')}
            </button>
          </div>
        </div>

        <div className="user-menu-section">
          <div className="user-menu-section-label">{t('userMenu.theme')}</div>
          <div className="user-menu-pill-group">
            {(['dark', 'light', 'system'] as AppTheme[]).map((theme) => (
              <button
                key={theme}
                type="button"
                className={`user-menu-pill ${settings.appearance.theme === theme ? 'is-selected' : ''}`}
                onClick={() => void onThemeChange(theme)}
              >
                {t(`theme.${theme}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="user-menu-section">
          <div className="user-menu-section-label">{t('userMenu.fontScale')}</div>
          <div className="user-menu-pill-group">
            {(['small', 'medium', 'large'] as FontScale[]).map((size) => (
              <button
                key={size}
                type="button"
                className={`user-menu-pill ${settings.appearance.fontScale === size ? 'is-selected' : ''}`}
                onClick={() => void onFontScaleChange(size)}
              >
                {t(`font.${size}`)}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="user-menu-settings-button"
          data-testid="open-settings-entry"
          onClick={onOpenSettings}
        >
          {t('userMenu.settings')}
        </button>
      </div>
    </div>,
    document.body,
  );
};

export default UserMenu;
