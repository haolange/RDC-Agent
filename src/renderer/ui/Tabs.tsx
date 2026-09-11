import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import './Tabs.css';

export interface TabItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
}

export type TabsVariant = 'underline' | 'segmented';

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  children?: ReactNode;
  className?: string;
  label?: string;
  /** `segmented` renders a compact single-select control instead of page tabs. */
  variant?: TabsVariant;
}

export function Tabs({
  tabs,
  value,
  onChange,
  children,
  className,
  label,
  variant = 'underline',
}: TabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusAt = (index: number) => {
    const enabled = tabs
      .map((tab, tabIndex) => (tab.disabled ? -1 : tabIndex))
      .filter((tabIndex) => tabIndex >= 0);
    if (enabled.length === 0) return;
    const current = enabled.indexOf(index);
    const next = enabled[current < 0 ? 0 : current];
    tabRefs.current[next]?.focus();
  };

  const move = (from: number, delta: number) => {
    const enabled = tabs
      .map((tab, index) => (tab.disabled ? -1 : index))
      .filter((index) => index >= 0);
    if (enabled.length === 0) return;
    const position = enabled.indexOf(from);
    const next = enabled[(position + delta + enabled.length) % enabled.length];
    onChange(tabs[next].id);
    tabRefs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(index, 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(index, -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      const first = tabs.findIndex((tab) => !tab.disabled);
      if (first >= 0) {
        onChange(tabs[first].id);
        focusAt(first);
      }
    } else if (event.key === 'End') {
      event.preventDefault();
      const last = [...tabs].reverse().findIndex((tab) => !tab.disabled);
      if (last >= 0) {
        const indexFromEnd = tabs.length - 1 - last;
        onChange(tabs[indexFromEnd].id);
        focusAt(indexFromEnd);
      }
    }
  };

  return (
    <div className={cn('ui-tabs', variant === 'segmented' && 'is-segmented', className)}>
      <div className="ui-tabs-list" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => {
          const selected = tab.id === value;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`ui-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`ui-tab-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={tab.disabled}
              className={cn('ui-tabs-tab', selected && 'is-selected')}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {children ? (
        <div
          className="ui-tabs-panel"
          role="tabpanel"
          id={`ui-tab-panel-${value}`}
          aria-labelledby={`ui-tab-${value}`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
