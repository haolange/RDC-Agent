import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { resolveTabNavigation } from './tabsNavigation';
import './Tabs.css';

export interface TabItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
  description?: string;
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
  const instanceId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = tabs.findIndex((tab) => tab.id === value);
  const tabId = (index: number) => `${instanceId}-tab-${index}`;
  const panelId = `${instanceId}-panel`;
  const hasPanel = children !== undefined && children !== null && children !== false;
  const focusIndex = selectedIndex >= 0 && !tabs[selectedIndex].disabled
    ? selectedIndex : tabs.findIndex((tab) => !tab.disabled);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = resolveTabNavigation(tabs, index, event.key);
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].id);
    tabRefs.current[next]?.focus();
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
              id={tabId(index)}
              aria-selected={selected}
              aria-controls={hasPanel && selected ? panelId : undefined}
              title={tab.description}
              tabIndex={index === focusIndex ? 0 : -1}
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
      {hasPanel ? (
        <div
          className="ui-tabs-panel"
          role="tabpanel"
          id={panelId}
          aria-labelledby={selectedIndex >= 0 ? tabId(selectedIndex) : undefined}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
