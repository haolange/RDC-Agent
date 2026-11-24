// @vitest-environment happy-dom
import { act, createElement, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ContextUsageIndicator } from '../../patterns/ContextUsageIndicator';
import { ComposerMenuRegistryProvider, useComposerMenu } from './useComposerMenuRegistry';

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

it('lets the portal own dismissal and preserves disclosure across reopenings', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const changes = vi.fn();
  function Owner() {
    const [expanded, setExpanded] = useState(false);
    const menu = useComposerMenu('usage');
    const agent = useComposerMenu('agent');
    return [createElement('button', {
      key: 'agent', onClick: agent.toggle, 'aria-expanded': agent.open, 'data-testid': 'agent-trigger',
    }), createElement(ContextUsageIndicator, {
      key: 'usage', menu,
      usage: null, prepared: null, phase: 'idle', selectedProfile: null,
      detailsExpanded: expanded,
      onDetailsExpandedChange: (next: boolean) => { changes(next); setExpanded(next); },
    })];
  }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    act(() => root.render(createElement(StrictMode, null,
      createElement(ComposerMenuRegistryProvider, { children: createElement(Owner) }))));
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="composer-usage-indicator"]')!;
    const agent = host.querySelector<HTMLButtonElement>('[data-testid="agent-trigger"]')!;
    act(() => agent.click());
    expect(agent.getAttribute('aria-expanded')).toBe('true');
    trigger.focus();
    act(() => trigger.click());
    expect(agent.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.context-breakdown-details')).toBeNull();
    const disclosure = document.querySelector<HTMLButtonElement>('.context-breakdown-details-toggle')!;
    act(() => disclosure.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(disclosure.isConnected).toBe(true);
    act(() => disclosure.click());
    expect(changes).toHaveBeenCalledExactlyOnceWith(true);
    expect(document.querySelector('.context-breakdown-details')).not.toBeNull();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    act(() => trigger.click());
    expect(document.querySelector('.context-breakdown-details-toggle')?.getAttribute('aria-expanded')).toBe('true');
    act(() => document.querySelector('.ui-reading-sheet-overlay')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    act(() => root.unmount()); host.remove();
    vi.unstubAllGlobals();
  }
});
