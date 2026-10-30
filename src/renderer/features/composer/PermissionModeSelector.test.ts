import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import type { RuntimePermissionState } from '@shared/types/runtimePermission';
import type { AgentPermissionMode, AppLanguage } from '@shared/types/settings';
import { translate } from '../../i18n/messages';

const fixture = vi.hoisted(() => ({
  snapshot: { mode: 'default', revision: 1 } as RuntimePermissionState | null,
  pendingMode: null as AgentPermissionMode | null,
  error: false,
  language: 'en' as AppLanguage,
  refresh: vi.fn(),
}));
vi.mock('../../stores/runtimePermissionStore', () => ({ useRuntimePermissionStore: (select: (state: typeof fixture) => unknown) => select(fixture) }));
vi.mock('../../stores/appSettingsStore', () => ({ useAppSettingsStore: (select: (state: object) => unknown) => select({ setAgentPermissionMode: vi.fn() }) }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: Parameters<typeof translate>[1]) => translate(fixture.language, key) }) }));
vi.mock('./useComposerMenuRegistry', () => ({ useComposerMenu: () => ({ open: true, close: vi.fn(), toggle: vi.fn(), setRoot: vi.fn(), setTrigger: vi.fn() }) }));
import { PermissionModeSelector } from './PermissionModeSelector';

afterEach(() => { fixture.snapshot = { mode: 'default', revision: 1 }; fixture.pendingMode = null; fixture.error = false; fixture.language = 'en'; });

it('exposes pending and confirmed modes separately and translates live status both ways', () => {
  fixture.pendingMode = 'full-access';
  for (const language of ['en', 'zh-CN', 'en'] as const) {
    fixture.language = language;
    const html = renderToStaticMarkup(React.createElement(PermissionModeSelector));
    expect(html).toContain('data-mode="default"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(translate(language, 'composer.permission.saving'));
    expect(html).toContain(translate(language, 'composer.permission.scope'));
    expect(html).toContain('role="status"');
  }
  fixture.pendingMode = null;
  fixture.snapshot = { mode: 'full-access', revision: 2 };
  const confirmed = renderToStaticMarkup(React.createElement(PermissionModeSelector));
  expect(confirmed).toContain('data-mode="full-access"');
  expect(confirmed).toContain(translate('en', 'composer.permission.applied'));
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
