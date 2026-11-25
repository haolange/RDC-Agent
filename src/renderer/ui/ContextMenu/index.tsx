import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useDynStyle } from '../../lib/useDynStyle';
import { documentFonts } from '../../lib/documentFonts';
import { placeAnchoredSurface } from '../../lib/anchoredSurface';
import { isTopOverlayLayer, useOverlayLayer } from '../../lib/overlayStack';
import { useDismissable } from '../../lib/useDismissable';
import { usePresence, type PresenceState } from '../usePresence';
import type { ContextMenuCommandId } from '../../lib/contextMenuCommands';
import type { ContextMenuItem } from '../../lib/contextMenuItems';
import './ContextMenu.css';

const VIEWPORT_MARGIN = 8;

export interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onSelect: (id: ContextMenuCommandId) => void;
  onClose: () => void;
}

function enabledCommandIndexes(items: ContextMenuItem[]): number[] {
  return items.flatMap((item, index) => (
    item.type === 'command' && !item.disabled ? [index] : []
  ));
}

function nextEnabledIndex(items: ContextMenuItem[], current: number, delta: number): number {
  const enabled = enabledCommandIndexes(items);
  if (enabled.length === 0) return -1;
  const position = enabled.indexOf(current);
  if (position < 0) return enabled[0];
  return enabled[(position + delta + enabled.length) % enabled.length];
}

/** The menu stays mounted while its exit plays; a closed menu no longer owns a layer, so it ignores input. */
export const ContextMenu: React.FC<ContextMenuProps> = ({ open, ...props }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const presence = usePresence(open, menuRef);
  if (!presence.mounted) return null;
  return <ContextMenuSurface {...props} open={open} state={presence.state} menuRef={menuRef} />;
};

const ContextMenuSurface: React.FC<Omit<ContextMenuProps, 'open'> & { open: boolean; state: PresenceState; menuRef: RefObject<HTMLDivElement> }> = ({
  open,
  state,
  menuRef,
  x,
  y,
  items,
  onSelect,
  onClose,
}) => {
  const { layerId } = useOverlayLayer(open);
  const [coords, setCoords] = useState({ left: x, top: y });
  const [activeIndex, setActiveIndex] = useState(() => enabledCommandIndexes(items)[0] ?? -1);
  const positionStyle = useDynStyle({
    left: `${coords.left}px`,
    top: `${coords.top}px`,
  });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const position = () => {
      const next = placeAnchoredSurface({ left: x, right: x, top: y, bottom: y },
        { width: menu.offsetWidth, height: menu.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }, 'start', 'bottom', VIEWPORT_MARGIN, 0);
      setCoords({ left: next.left, top: next.top });
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(menu);
    window.addEventListener('resize', position);
    documentFonts()?.addEventListener('loadingdone', position);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      documentFonts()?.removeEventListener('loadingdone', position);
    };
  }, [x, y, items, menuRef]);

  useDismissable({ open, layerId, inside: () => [menuRef.current], onDismiss: onClose });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopOverlayLayer(layerId)) return;
      if (event.key === 'Tab') { onClose(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) => nextEnabledIndex(items, current, event.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        const enabled = enabledCommandIndexes(items);
        if (enabled.length === 0) return;
        event.preventDefault();
        setActiveIndex(event.key === 'Home' ? enabled[0] : enabled[enabled.length - 1]);
        return;
      }
      if (event.key === 'Enter') {
        const item = items[activeIndex];
        if (item?.type !== 'command' || item.disabled) return;
        event.preventDefault();
        onSelect(item.id);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activeIndex, items, layerId, onClose, onSelect, menuRef]);

  useEffect(() => {
    const origin = document.activeElement;
    return () => { if (origin instanceof HTMLElement && origin.isConnected) origin.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
  }, [activeIndex, menuRef]);

  const labelledBy = useMemo(
    () => items.find((item) => item.type === 'command')?.id ?? 'copy',
    [items],
  );

  return createPortal(
    <div
      ref={menuRef}
      className="app-context-menu"
      data-state={state}
      data-testid="app-context-menu"
      role="menu"
      aria-labelledby={`app-context-menu-${labelledBy}`}
      {...positionStyle}
    >
      {items.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={`sep-${index}`} className="app-context-menu-divider" role="separator" />;
        }
        return (
          <button
            key={item.id}
            id={`app-context-menu-${item.id}`}
            type="button"
            role="menuitem"
            className={`app-context-menu-item${index === activeIndex ? ' is-active' : ''}`}
            disabled={item.disabled}
            tabIndex={index === activeIndex ? 0 : -1}
            onMouseEnter={() => {
              if (!item.disabled) setActiveIndex(index);
            }}
            onClick={() => {
              if (!item.disabled) onSelect(item.id);
            }}
          >
            <span className="app-context-menu-label">{item.label}</span>
            <span className="app-context-menu-shortcut">{item.shortcut}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
};
