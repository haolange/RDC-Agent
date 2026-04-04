import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { AppLanguage, AppSettings, AppTheme, FontScale } from '@shared/types/settings';
import { useI18n } from '../../i18n';
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

  const position = useMemo(() => {
    if (!anchorRect) return { left: 16, top: window.innerHeight - 360 };
    const left = Math.max(16, Math.min(anchorRect.left, window.innerWidth - MENU_WIDTH - 16));
    const top = Math.max(16, anchorRect.top - 308);
    return { left, top };
  }, [anchorRect]);

  if (!open) return null;

  return createPortal(
    <div className="user-menu-backdrop">
      <div
        ref={menuRef}
        className="user-menu-popover visible"
        style={{ left: position.left, top: position.top }}
      >
        <div className="user-menu-header">
          <div className="user-menu-avatar">
            {(settings.profile.nickname || 'RA').trim().slice(0, 2).toUpperCase()}
          </div>
          <div className="user-menu-header-copy">
            <div className="user-menu-name">{settings.profile.nickname}</div>
            <div className="user-menu-subtitle">{t('sidebar.userSubtitle')}</div>
          </div>
        </div>

        <div className="user-menu-section">
          <div className="user-menu-section-label">{t('userMenu.language')}</div>
          <div className="user-menu-pill-group">
            <button
              type="button"
              className={`user-menu-pill ${settings.appearance.language === 'zh-CN' ? 'active' : ''}`}
              onClick={() => void onLanguageChange('zh-CN')}
            >
              简体中文
            </button>
            <button
              type="button"
              className={`user-menu-pill ${settings.appearance.language === 'en' ? 'active' : ''}`}
              onClick={() => void onLanguageChange('en')}
            >
              English
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
                className={`user-menu-pill ${settings.appearance.theme === theme ? 'active' : ''}`}
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
                className={`user-menu-pill ${settings.appearance.fontScale === size ? 'active' : ''}`}
                onClick={() => void onFontScaleChange(size)}
              >
                {t(`font.${size}`)}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="user-menu-settings-button" onClick={onOpenSettings}>
          {t('userMenu.settings')}
        </button>
      </div>
    </div>,
    document.body,
  );
};

export default UserMenu;
