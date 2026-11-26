import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n';
import { useDismissable } from '../../lib/useDismissable';
import { useDynStyle } from '../../lib/useDynStyle';
import { ProfileAvatar } from '../../patterns/ProfileAvatar';
import { Button } from '../../ui/Button';
import type { AppSettings } from '@shared/types/settings';
import './UserMenu.css';

interface UserMenuProps {
  anchorRect: DOMRect | null;
  anchorElement: HTMLButtonElement | null;
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onOpenSettings: () => void;
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
}) => {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    // Wait for the anchor drawer's focus restoration and measured visibility.
    const frame = requestAnimationFrame(() => {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      menuRef.current?.querySelector<HTMLButtonElement>('[data-testid="open-settings-entry"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const [position, setPosition] = useState({ left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN, ready: false });

  useDismissable({
    open,
    inside: () => [menuRef.current, anchorElement],
    onDismiss: (reason) => {
      onClose();
      if (reason === 'escape' && returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    },
  });

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

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updatePosition()) : null;

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
  }, [open, updatePosition, settings.appearance.fontScale, settings.profile.nickname]);

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
