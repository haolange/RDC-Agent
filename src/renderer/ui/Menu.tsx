import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { cn } from '../lib/cn';
import { Icon } from './Icon';
import { Popover } from './Popover';
import './Menu.css';

export interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  type?: 'item' | 'radio' | 'separator';
  checked?: boolean;
  onSelect?: () => void;
}

export interface MenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  items: MenuItem[];
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
  className?: string;
  label?: string;
}

function enabledIndexes(items: MenuItem[]): number[] {
  return items.flatMap((item, index) => (
    item.type !== 'separator' && !item.disabled ? [index] : []
  ));
}

export function Menu({
  open,
  onOpenChange,
  trigger,
  items,
  align = 'start',
  side = 'bottom',
  className,
  label,
}: MenuProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = useMemo(() => enabledIndexes(items), [items]);
  const [activeIndex, setActiveIndex] = useState(() => enabled[0] ?? -1);

  useEffect(() => {
    if (!open) return;
    setActiveIndex((current) => (enabled.includes(current) ? current : enabled[0] ?? -1));
  }, [open, enabled]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  const move = (delta: number) => {
    if (enabled.length === 0) return;
    const position = enabled.indexOf(activeIndex);
    const next = enabled[(position < 0 ? 0 : position + delta + enabled.length) % enabled.length];
    setActiveIndex(next);
  };

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      align={align}
      side={side}
      className={cn('ui-menu', className)}
      role="presentation"
    >
      <div
        role="menu"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            move(1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            move(-1);
          } else if (event.key === 'Home') {
            event.preventDefault();
            if (enabled[0] != null) setActiveIndex(enabled[0]);
          } else if (event.key === 'End') {
            event.preventDefault();
            const last = enabled[enabled.length - 1];
            if (last != null) setActiveIndex(last);
          }
        }}
      >
        {items.map((item, index) => {
          if (item.type === 'separator') {
            return <div key={`sep-${item.id}-${index}`} className="ui-menu-separator" role="separator" />;
          }
          const role = item.type === 'radio' ? 'menuitemradio' : 'menuitem';
          return (
            <button
              key={item.id}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role={role}
              aria-checked={item.type === 'radio' ? Boolean(item.checked) : undefined}
              disabled={item.disabled}
              tabIndex={index === activeIndex ? 0 : -1}
              className={cn(
                'ui-menu-item',
                index === activeIndex && 'is-active',
                item.checked && 'is-selected',
                item.disabled && 'is-disabled',
              )}
              onMouseEnter={() => {
                if (!item.disabled) setActiveIndex(index);
              }}
              onClick={() => {
                if (item.disabled) return;
                item.onSelect?.();
                onOpenChange(false);
              }}
            >
              <span>{item.label}</span>
              {item.checked ? <Icon name="check" size={12} className="ui-menu-check" /> : null}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
