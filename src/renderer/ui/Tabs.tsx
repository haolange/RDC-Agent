import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { resolveTabNavigation } from './tabsNavigation';
import { useTabsLayout } from './useTabsLayout';
import './Tabs.css';

export interface TabItem {
  id: string;
  label: string;
  /** Required on every tab for `collapsible` lists: the icon carries the tab once labels no longer fit. */
  icon?: ReactNode;
  /** Shown as a count badge; zero and undefined hide it. */
  count?: number;
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
  /** `underline` is page navigation; `segmented` is a compact single-select control. */
  variant?: TabsVariant;
  /** Makes the tab list and each option share the available width equally. */
  fullWidth?: boolean;
  /** Drops to icon-only with tooltips when the labelled row would overflow; tabs never overlap or wrap. */
  collapsible?: boolean;
}

export function Tabs({
  tabs,
  value,
  onChange,
  children,
  className,
  label,
  variant = 'underline',
  fullWidth = false,
  collapsible = false,
}: TabsProps) {
  const instanceId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = tabs.findIndex((tab) => tab.id === value);
  const { collapsed, measured, indicatorStyle } = useTabsLayout(rootRef, listRef, selectedIndex, collapsible);
  const tabId = (index: number) => `${instanceId}-tab-${index}`;
  const panelId = `${instanceId}-panel`;
  const hasPanel = children !== undefined && children !== null && children !== false;
  const focusIndex =
    selectedIndex >= 0 && !tabs[selectedIndex].disabled ? selectedIndex : tabs.findIndex((tab) => !tab.disabled);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = resolveTabNavigation(tabs, index, event.key);
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        'ui-tabs',
        variant === 'segmented' && 'is-segmented',
        fullWidth && 'is-full-width',
        collapsed && 'is-icon-only',
        className,
      )}
    >
      <div ref={listRef} className={cn('ui-tabs-list', measured && 'is-measured')} role="tablist" aria-label={label}>
        {selectedIndex >= 0 ? <span className="ui-tabs-indicator" aria-hidden="true" {...indicatorStyle} /> : null}
        {tabs.map((tab, index) => {
          const selected = tab.id === value;
          const tooltip = collapsed ? [tab.label, tab.description].filter(Boolean).join(' · ') : tab.description;
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
              aria-label={collapsed ? tab.label : undefined}
              data-tooltip={tooltip}
              tabIndex={index === focusIndex ? 0 : -1}
              disabled={tab.disabled}
              className={cn('ui-tabs-tab', selected && 'is-selected')}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {tab.icon ? (
                <span className="ui-tabs-icon" aria-hidden="true">
                  {tab.icon}
                </span>
              ) : null}
              <span className="ui-tabs-label">{tab.label}</span>
              {tab.count ? <span className="ui-tabs-count">{tab.count}</span> : null}
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
