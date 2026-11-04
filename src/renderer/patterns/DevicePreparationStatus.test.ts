// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { DevicePreparationStatus } from './DevicePreparationStatus';
import { translate } from '../i18n/messages';
import type { ReplayDeviceIssue } from '@shared/types/device';

afterEach(() => { vi.unstubAllGlobals(); });

const locale = vi.hoisted(() => ({ language: 'en' as 'en' | 'zh-CN' }));
vi.mock('../i18n', () => ({ useI18n: () => ({ t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate(locale.language, key, params) }) }));
it.each(['en', 'zh-CN'] as const)('uses a short localized failure with raw diagnostics only in disclosure (%s)', (language) => {
  locale.language = language;
  const diagnostic = 'CheckRemoteServerConnection(127.0.0.1:51867) failed: '.repeat(30);
  const html = renderToStaticMarkup(createElement(DevicePreparationStatus, {
    preparation: { targetDeviceId: 'android', phase: 'failed', issue: { code: 'remote_version_mismatch', stage: 'verifying', diagnostic, recovery: 'retry', expectedVersion: '1.45', actualVersion: '1.36' } }, onRetry: () => {}, onCancel: () => {},
  }));
  expect(html).toContain(translate(language, 'device.issue.version'));
  expect(html).toContain('<details'); expect(html).toContain('<pre');
  expect(html).not.toMatch(/<p role="status"[^>]*>CheckRemoteServerConnection/);
  expect(html).toContain(translate(language, 'device.prepare.retry'));
});
it.each(['en', 'zh-CN'] as const)('offers only explicit installation verification while outcome is unknown (%s)', (language) => {
  locale.language = language;
  const issue: ReplayDeviceIssue = { code: 'remote_install_unconfirmed', stage: 'installing', diagnostic: 'Package Manager did not settle', recovery: 'retry', deviceAction: { kind: 'package_install', outcome: 'unconfirmed', uninstalledExisting: true } };
  const render = (code: string, recovery: ReplayDeviceIssue['recovery'], phase: 'failed' | 'cancelled' | 'verifying' = 'failed') => renderToStaticMarkup(createElement(DevicePreparationStatus, {
    preparation: { targetDeviceId: 'android', phase, issue: { ...issue, code, recovery } },
    issue: { code: 'remote_busy', stage: 'checking', diagnostic: 'Different target rejected', recovery: 'retry' },
    onRetry: () => {}, onCancel: () => {},
  }));
  for (const code of ['remote_install_unconfirmed', 'RDC_DEVICE_ACTION_UNCONFIRMED']) {
    const html = render(code, 'retry');
    expect(html).toContain(translate(language, 'device.issue.installUnconfirmed'));
    expect(html).toContain(translate(language, 'device.prepare.installUnconfirmed'));
    expect(html).toContain(translate(language, 'device.prepare.previousHelperRemoved'));
    expect(html).toContain(translate(language, 'device.prepare.retry'));
    expect(html).toContain('<pre class="device-preparation-diagnostic">Package Manager did not settle</pre>');
    expect(html.match(/<button/g)).toHaveLength(1);
    const container = document.createElement('div'); container.innerHTML = html;
    const actionLabels = [...container.querySelectorAll('button')].map(button => button.textContent);
    expect(actionLabels).toEqual([translate(language, 'device.prepare.retry')]);
    expect(html).not.toContain('Verify and reconnect');
  }
  expect(render(issue.code, null, 'cancelled')).not.toContain('<button');
  const pending = render(issue.code, 'retry', 'verifying');
  expect(pending.match(/<button/g)).toHaveLength(1);
  expect(pending).toContain('aria-busy="true"');
  expect(pending).toContain('aria-disabled="true"');
});
it('keeps the focused verification button mounted through pending and unknown results while rejecting repeated clicks', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const onRetry = vi.fn(); const onCancel = vi.fn();
  const issue: ReplayDeviceIssue = { code: 'remote_install_unconfirmed', stage: 'installing', diagnostic: 'Installation pending', recovery: 'retry', deviceAction: { kind: 'package_install', outcome: 'unconfirmed', uninstalledExisting: false } };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const render = (phase: 'failed' | 'verifying') => act(async () => root.render(createElement(DevicePreparationStatus, {
    preparation: { targetDeviceId: 'android', phase, issue }, onRetry, onCancel,
  })));
  try {
    await render('failed');
    const button = host.querySelector<HTMLButtonElement>('.device-preparation-actions button')!;
    button.focus(); await act(async () => button.click());
    expect(onRetry).toHaveBeenCalledOnce();
    await render('verifying');
    expect(host.querySelector('.device-preparation-actions button')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.classList.contains('is-disabled')).toBe(true);
    await act(async () => { button.click(); button.click(); });
    expect(onRetry).toHaveBeenCalledOnce();
    await render('failed');
    expect(host.querySelector('.device-preparation-actions button')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-busy')).toBe('false');
    expect(button.getAttribute('aria-disabled')).not.toBe('true');
    await act(async () => button.click());
    expect(onRetry).toHaveBeenCalledTimes(2); expect(onCancel).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it.each([false, true])('preserves the disconnect action node through cancellation without moving user focus (focus moved: %s)', async (moveFocus) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let finish!: () => void;
  const onCancel = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })); const onRetry = vi.fn();
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const outside = document.createElement('button'); document.body.append(outside);
  const render = (phase: 'ready' | 'cancelled', disabled = false) => act(async () => root.render(createElement(DevicePreparationStatus, {
    preparation: { targetDeviceId: 'android', phase, issue: null }, disabled, onRetry, onCancel,
  })));
  try {
    await render('ready');
    const button = host.querySelector<HTMLButtonElement>('.device-preparation-actions button')!;
    button.focus(); await act(async () => { button.click(); button.click(); });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(button.getAttribute('aria-busy')).toBe('true'); expect(button.disabled).toBe(false);
    expect(document.activeElement).toBe(button);
    if (moveFocus) outside.focus();
    await render('cancelled', true);
    expect(host.querySelector('.device-preparation-actions button')).toBe(button);
    expect(button.textContent).toBe(translate(locale.language, 'device.prepare.retry'));
    expect(document.activeElement).toBe(moveFocus ? outside : button);
    await act(async () => { button.click(); finish(); });
    expect(onCancel).toHaveBeenCalledOnce(); expect(onRetry).not.toHaveBeenCalled();
    await render('cancelled');
    expect(host.querySelector('.device-preparation-actions button')).toBe(button);
    expect(document.activeElement).toBe(moveFocus ? outside : button);
    expect(button.getAttribute('aria-busy')).toBe('false'); expect(button.getAttribute('aria-disabled')).not.toBe('true');
    await act(async () => button.click()); expect(onRetry).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); host.remove(); outside.remove(); }
});
it('keeps normal preparation cancellable while its connection request is still running', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let finish!: () => void;
  const onRetry = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })); const onCancel = vi.fn();
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const render = (phase: 'cancelled' | 'checking') => act(async () => root.render(createElement(DevicePreparationStatus, {
    preparation: { targetDeviceId: 'android', phase, issue: null }, onRetry, onCancel,
  })));
  try {
    await render('cancelled');
    const button = host.querySelector<HTMLButtonElement>('.device-preparation-actions button')!;
    await act(async () => button.click()); expect(onRetry).toHaveBeenCalledOnce();
    await render('checking');
    expect(host.querySelector('.device-preparation-actions button')).toBe(button);
    expect(button.textContent).toBe(translate(locale.language, 'device.prepare.cancel'));
    expect(button.getAttribute('aria-disabled')).not.toBe('true');
    await act(async () => { button.click(); finish(); }); expect(onCancel).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it.each(['en', 'zh-CN'] as const)('reports a committed installation after cancellation only when confirmed (%s)', (language) => {
  locale.language = language;
  const render = (phase: 'cancelled' | 'ready', installedApk?: boolean) => renderToStaticMarkup(createElement(DevicePreparationStatus, {
    preparation: { targetDeviceId: 'android', phase, issue: null,
      ...(installedApk !== undefined ? { installation: { installedApk, uninstalledExisting: false, installMode: 'update' as const } } : {}),
    }, onRetry: () => {}, onCancel: () => {},
  }));
  const note = translate(language, 'device.prepare.installedBeforeCancel');
  expect(render('cancelled', true)).toContain(note);
  expect(render('cancelled', false)).not.toContain(note);
  expect(render('cancelled')).not.toContain(note);
  expect(render('ready', true)).not.toContain(note);
});

it.each(['en', 'zh-CN'] as const)('keeps only disconnect after connecting and explains possible phone authorization (%s)', language => {
  locale.language = language;
  const render = (phase: 'starting' | 'ready') => renderToStaticMarkup(createElement(DevicePreparationStatus, {
    preparation: { targetDeviceId: 'android', phase, issue: null },
    onRetry: () => {}, onCancel: () => {},
  }));
  expect(render('starting')).toContain(translate(language, 'device.prepare.phoneAuthorization'));
  const html = render('ready');
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).toContain(translate(language, 'device.prepare.disconnect'));
  expect(html).not.toContain('Choose Capture');
});
