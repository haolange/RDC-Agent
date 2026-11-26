// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { translate } from '../../i18n/messages';
import { PermissionModeSelector, PermissionSwitchNotice } from './PermissionModeSelector';
import type { RuntimePermissionState } from '@shared/types/runtimePermission';
import type { AgentPermissionMode, AppLanguage } from '@shared/types/settings';

const fixture = vi.hoisted(() => ({
  snapshot: { mode: 'default', revision: 1 } as RuntimePermissionState | null,
  pendingMode: null as AgentPermissionMode | null,
  error: false,
  failedSwitch: null as { mode: AgentPermissionMode; detail: string } | null,
  language: 'en' as AppLanguage,
  refresh: vi.fn(),
  setMode: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../stores/runtimePermissionStore', () => ({
  useRuntimePermissionStore: (select: (state: typeof fixture) => unknown) => select(fixture),
}));
vi.mock('../../stores/appSettingsStore', () => ({
  useAppSettingsStore: (select: (state: object) => unknown) => select({ setAgentPermissionMode: fixture.setMode }),
}));
vi.mock('../../i18n', () => ({
  useI18n: () => ({
    t: (key: Parameters<typeof translate>[1], params?: Record<string, string>) =>
      translate(fixture.language, key, params),
  }),
}));
vi.mock('./useComposerMenuRegistry', () => ({
  useComposerMenu: () => ({ open: true, close: vi.fn(), toggle: vi.fn(), setRoot: vi.fn(), setTrigger: vi.fn() }),
}));

afterEach(() => {
  Object.assign(fixture, {
    snapshot: { mode: 'default', revision: 1 },
    pendingMode: null,
    error: false,
    failedSwitch: null,
    language: 'en',
  });
  fixture.setMode.mockClear();
  vi.unstubAllGlobals();
});

it('exposes pending and confirmed modes separately and keeps mode descriptions on hover', () => {
  fixture.pendingMode = 'full-access';
  for (const language of ['en', 'zh-CN', 'en'] as const) {
    fixture.language = language;
    const html = renderToStaticMarkup(React.createElement(PermissionModeSelector));
    expect(html).toContain('data-mode="default"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(translate(language, 'composer.permission.saving'));
    expect(html).toContain(`data-tooltip="${translate(language, 'composer.permission.full-accessDesc')}"`);
    expect(html).not.toContain('composer-permission-menu-desc');
  }
  fixture.pendingMode = null;
  fixture.snapshot = { mode: 'full-access', revision: 2 };
  const confirmed = renderToStaticMarkup(React.createElement(PermissionModeSelector));
  expect(confirmed).toContain('data-mode="full-access"');
  expect(confirmed.match(/composer-permission-menu-check/g)).toHaveLength(1);
});

it('does not claim a default effective mode when main state is unavailable', () => {
  fixture.snapshot = null;
  fixture.error = true;
  const html = renderToStaticMarkup(React.createElement(PermissionModeSelector));
  expect(html.split('</button>', 1)[0]).not.toContain('data-mode=');
  expect(html).toContain(translate('en', 'composer.permission.loading'));
  expect(html).toContain(translate('en', 'composer.permission.retry'));
  expect(html).toContain('disabled=""');
});

it('keeps every mode name in one label cell, shows the requested mode while it applies, and moves through modes by keys', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const shownLabel = () => host.querySelector('.composer-permission-pill-label-option.is-shown')?.textContent;
  try {
    fixture.pendingMode = 'full-access';
    await act(async () => root.render(React.createElement(PermissionModeSelector)));
    expect(
      [...host.querySelectorAll('.composer-permission-pill-label-option')].map((option) => option.textContent),
    ).toEqual(['Default', 'Auto-review', 'Full access', 'Custom']);
    expect(shownLabel()).toBe('Full access');
    expect(host.querySelector('[data-testid="composer-permission-pill"]')?.getAttribute('data-mode')).toBe('default');
    // Main answers: the confirmed mode takes the same cell.
    fixture.pendingMode = null;
    fixture.snapshot = { mode: 'full-access', revision: 2 };
    await act(async () => root.render(React.createElement(PermissionModeSelector)));
    expect(shownLabel()).toBe('Full access');
    // Opening the menu puts focus on the confirmed mode.
    await act(async () => root.render(null));
    await act(async () => root.render(React.createElement(PermissionModeSelector)));
    expect(document.activeElement?.getAttribute('data-mode')).toBe('full-access');
    const press = (key: string) =>
      act(async () => {
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    await press('ArrowDown');
    expect(document.activeElement?.getAttribute('data-mode')).toBe('custom');
    await press('ArrowDown');
    expect(document.activeElement?.getAttribute('data-mode')).toBe('default');
    await press('End');
    expect(document.activeElement?.getAttribute('data-mode')).toBe('custom');
    await press('ArrowUp');
    expect(document.activeElement?.getAttribute('data-mode')).toBe('full-access');
    await press('Home');
    expect(document.activeElement?.getAttribute('data-mode')).toBe('default');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('says in the footer which switch failed, keeps its detail for copying, and retries that switch', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(PermissionSwitchNotice)));
    expect(host.innerHTML).toBe('');
    fixture.failedSwitch = { mode: 'full-access', detail: 'SETTINGS_WRITE_FAILED: disk full' };
    await act(async () => root.render(React.createElement(PermissionSwitchNotice)));
    expect(host.querySelector('[data-testid="composer-permission-notice"]')?.textContent).toContain(
      translate('en', 'composer.permission.switchFailed', { mode: 'Full access' }),
    );
    expect(host.textContent).not.toContain('disk full');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="composer-permission-notice"] button')!.click(),
    );
    expect(fixture.setMode).toHaveBeenCalledWith('full-access');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
