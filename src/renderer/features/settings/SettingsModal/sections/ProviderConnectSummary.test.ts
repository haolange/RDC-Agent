import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { translate } from '../../../../i18n/messages';
import { connectionPhase, ProviderConnectionStatusLine } from './ProviderConnectSummary';
import type { ProviderConnectionDraft } from '../types';

const draft = (patch: Partial<ProviderConnectionDraft> = {}) => ({ busy: 'idle', error: '', ...patch }) as ProviderConnectionDraft;

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
  const t = translate.bind(null, 'zh-CN');
  for (const phase of ['untested', 'testPassed'] as const) {
    view.innerHTML = renderToStaticMarkup(createElement(ProviderConnectionStatusLine, { phase, t }));
    expect(view.querySelector('[role="status"]')?.textContent).toBe(t(`settings.providers.connectionPhase.${phase}`));
    expect(view.querySelector('button, [tabindex]')).toBeNull();
  }
});
