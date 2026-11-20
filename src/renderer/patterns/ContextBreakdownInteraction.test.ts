// @vitest-environment happy-dom
import { act, createElement, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ContextUsageIndicator } from './ContextUsageIndicator';

vi.mock('../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

it('routes disclosure intent to its owner and preserves that value when the sheet reopens', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const changes = vi.fn();
  function Owner() {
    const [expanded, setExpanded] = useState(false);
    return createElement(ContextUsageIndicator, {
      usage: null, prepared: null, phase: 'idle', selectedProfile: null,
      detailsExpanded: expanded,
      onDetailsExpandedChange: (next: boolean) => { changes(next); setExpanded(next); },
    });
  }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    act(() => root.render(createElement(StrictMode, null, createElement(Owner))));
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="composer-usage-indicator"]')!;
    act(() => trigger.click());
    expect(document.querySelector('.context-breakdown-details')).toBeNull();
    act(() => document.querySelector<HTMLButtonElement>('.context-breakdown-details-toggle')!.click());
    expect(changes).toHaveBeenCalledExactlyOnceWith(true);
    expect(document.querySelector('.context-breakdown-details')).not.toBeNull();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    act(() => trigger.click());
    expect(document.querySelector('.context-breakdown-details-toggle')?.getAttribute('aria-expanded')).toBe('true');
  } finally {
    act(() => root.unmount()); host.remove();
    vi.unstubAllGlobals();
  }
});
