import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { translate } from '../../../../i18n/messages';
import { connectionPhase, ProviderConnectionStatusLine } from './ProviderConnectSummary';
import type { ProviderConnectionDraft } from '../types';
vi.mock('../../../../i18n', () => ({
  useI18n: () => ({
    t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
      translate('zh-CN', key, params),
  }),
}));

const draft = (patch: Partial<ProviderConnectionDraft> = {}) =>
  ({ busy: 'idle', error: '', ...patch }) as ProviderConnectionDraft;

it('reads connected only for a saved, unchanged connection; a passing test of unsaved changes says so', () => {
  expect(connectionPhase(draft(), false)).toBe('untested');
  expect(connectionPhase(draft(), true)).toBe('testPassed');
  expect(connectionPhase(draft(), true, true)).toBe('connected');
  expect(connectionPhase(draft(), false, true)).toBe('connected');
  expect(connectionPhase(draft({ error: 'Unauthorized' }), true, true)).toBe('failed');
  expect(connectionPhase(draft({ busy: 'testing' }), false)).toBe('testing');
  expect(connectionPhase(draft({ busy: 'saving' }), true)).toBe('saving');
});

it('presents an idle connection as passive status and announces an unsaved successful test distinctly', () => {
  const view = document.createElement('footer');
  for (const phase of ['untested', 'testPassed'] as const) {
    view.innerHTML = renderToStaticMarkup(createElement(ProviderConnectionStatusLine, { phase }));
    expect(view.querySelector('[role="status"]')?.textContent).toBe(
      translate('zh-CN', `settings.providers.connectionPhase.${phase}`),
    );
    expect(view.querySelector('button, [tabindex]')).toBeNull();
  }
});
