import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppLanguage, AppSettings, AppTheme, FontScale } from '@shared/types/settings';
import { useI18n } from '../../i18n';
import { useDynStyle } from '../../lib/useDynStyle';
import { ProfileAvatar } from '../../patterns/ProfileAvatar';
import { Tabs } from '../../ui/Tabs';
import { Button } from '../../ui/Button';
import './UserMenu.css';

interface UserMenuProps {
  anchorRect: DOMRect | null;
  anchorElement: HTMLButtonElement | null;
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onOpenSettings: () => void;
  onThemeChange: (theme: AppTheme) => void;
  onLanguageChange: (language: AppLanguage) => void;
  onFontScaleChange: (fontScale: FontScale) => void;
}

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
  anchorElement,
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
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    // Wait for the anchor drawer's focus restoration and measured visibility.
    const frame = requestAnimationFrame(() => {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      menuRef.current?.querySelector<HTMLButtonElement>('[role="tab"][tabindex="0"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const [position, setPosition] = useState({ left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN, ready: false });

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchorElement?.contains(target)) return;
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose, anchorElement]);

  const updatePosition = useCallback(() => {
    const menuElement = menuRef.current;
    if (!menuElement) return;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const { width: menuWidth, height: menuHeight } = menuElement.getBoundingClientRect();
    if (menuWidth <= 0 || menuHeight <= 0) return;

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
        className="user-menu-popover is-visible"
        id="sidebar-user-menu"
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

        <div className="user-menu-preferences">
        <div className="user-menu-section">
          <div className="user-menu-section-label">{t('userMenu.language')}</div>
          <Tabs variant="segmented" fullWidth label={t('userMenu.language')} value={settings.appearance.language}
            onChange={(value) => onLanguageChange(value as AppLanguage)}
            tabs={[{ id: 'zh-CN', label: t('language.zh') }, { id: 'en', label: t('language.en') }]} />
        </div>

        <div className="user-menu-section">
          <div className="user-menu-section-label">{t('userMenu.theme')}</div>
          <Tabs variant="segmented" fullWidth label={t('userMenu.theme')} value={settings.appearance.theme}
            onChange={(value) => onThemeChange(value as AppTheme)}
            tabs={(['dark', 'light', 'system'] as AppTheme[]).map((theme) => ({ id: theme, label: t(`theme.${theme}`) }))} />
        </div>

        <div className="user-menu-section">
          <div className="user-menu-section-label">{t('userMenu.fontScale')}</div>
          <Tabs variant="segmented" fullWidth label={t('userMenu.fontScale')} value={settings.appearance.fontScale}
            onChange={(value) => onFontScaleChange(value as FontScale)}
            tabs={(['small', 'medium', 'large'] as FontScale[]).map((size) => ({ id: size, label: t(`font.${size}`) }))} />
        </div>
        </div>

        <Button
          type="button"
          variant="primary"
          className="user-menu-settings-button"
          data-testid="open-settings-entry"
          onClick={onOpenSettings}
        >
          {t('userMenu.settings')}
        </Button>
      </div>
    </div>,
    document.body,
  );
};

export default UserMenu;
