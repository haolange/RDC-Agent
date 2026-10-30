import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDynStyle } from '../../lib/useDynStyle';
import type { ContextMenuCommandId } from '../../lib/contextMenuCommands';
import type { ContextMenuItem } from '../../lib/contextMenuItems';
import { placeAnchoredSurface } from '../../lib/anchoredSurface';
import { isTopOverlayLayer, useOverlayLayer } from '../../lib/overlayStack';
import './ContextMenu.css';

const VIEWPORT_MARGIN = 8;

export interface ContextMenuProps {
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

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  items,
  onSelect,
  onClose,
}) => {
  const { layerId } = useOverlayLayer(true);
  const menuRef = useRef<HTMLDivElement>(null);
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
    document.fonts?.addEventListener('loadingdone', position);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      document.fonts?.removeEventListener('loadingdone', position);
    };
  }, [x, y, items]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!isTopOverlayLayer(layerId)) return;
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopOverlayLayer(layerId)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
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
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [activeIndex, items, layerId, onClose, onSelect]);

  useEffect(() => {
    const origin = document.activeElement;
    return () => { if (origin instanceof HTMLElement && origin.isConnected) origin.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
  }, [activeIndex]);

  const labelledBy = useMemo(
    () => items.find((item) => item.type === 'command')?.id ?? 'copy',
    [items],
  );

  return createPortal(
    <div
      ref={menuRef}
      className="app-context-menu"
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
