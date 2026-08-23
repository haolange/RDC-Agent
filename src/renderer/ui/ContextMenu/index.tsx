import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDynStyle } from '../../lib/useDynStyle';
import type { ContextMenuCommandId } from '../../lib/contextMenuCommands';
import type { ContextMenuItem } from '../../lib/contextMenuItems';
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
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let left = x;
    let top = y;
    if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
      left = window.innerWidth - width - VIEWPORT_MARGIN;
    }
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      top = window.innerHeight - height - VIEWPORT_MARGIN;
    }
    setCoords({
      left: Math.max(VIEWPORT_MARGIN, left),
      top: Math.max(VIEWPORT_MARGIN, top),
    });
  }, [x, y, items]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
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
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeIndex, items, onClose, onSelect]);

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
