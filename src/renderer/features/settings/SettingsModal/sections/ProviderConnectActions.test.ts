// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { createProviderConnectionDraft } from '../providerConnectionState';
import { ProviderConnectActions } from './ProviderConnectActions';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { ProviderConnectionDraft } from '../types';
vi.mock('../../../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

it('allows testing a stored account credential without claiming it is verified or permitting save', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const provider = {
    id: 'chatgpt-account',
    authMode: 'account',
    models: [],
    isConfigured: false,
    hasStoredSecretByAuthMode: { account: true },
    providerAvailability: { state: 'available' },
  } as unknown as LlmProviderEntry;
  const test = vi.fn(),
    save = vi.fn();
  const render = () =>
    act(() =>
      root.render(
        createElement(ProviderConnectActions, {
          draft: createProviderConnectionDraft(provider),
          provider,
          accountConnected: false,
          devicePending: false,
          needsCredentials: false,
          needsBaseUrl: false,
          hasFreshTest: false,
          onClose: vi.fn(),
          onTest: test,
          onSave: save,
        }),
      ),
    );
  try {
    render();
    const testButton = host.querySelector<HTMLButtonElement>('[data-testid="settings-provider-connect-test"]')!;
    expect(testButton.disabled).toBe(false);
    act(() => testButton.click());
    expect(test).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="settings-provider-connect-save"]')!.disabled).toBe(
      true,
    );
    provider.hasStoredSecretByAuthMode = { account: false };
    render();
    expect(testButton.disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(provider.isConfigured).toBe(false);
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

const renderLabels = (busy: ProviderConnectionDraft['busy']) => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    createElement(ProviderConnectActions, {
      draft: { busy, authMode: 'api-key', authCode: '', models: [] } as unknown as ProviderConnectionDraft,
      provider: {
        authMode: 'api-key',
        isConfigured: true,
        catalogOwnership: 'user-managed',
        providerAvailability: { state: 'available' },
      } as unknown as LlmProviderEntry,
      accountConnected: false,
      devicePending: false,
      needsCredentials: false,
      needsBaseUrl: false,
      hasFreshTest: false,
      onClose: () => undefined,
      onTest: () => undefined,
      onSave: () => undefined,
    }),
  );
  const labels = (testId: string) =>
    [...host.querySelectorAll(`[data-testid="${testId}"] .settings-provider-action-label-option`)].map((option) => ({
      text: option.textContent,
      shown: option.classList.contains('is-shown') && !option.hasAttribute('aria-hidden'),
    }));
  return { save: labels('settings-provider-connect-save'), test: labels('settings-provider-connect-test') };
};

it('keeps every label of a connect action in place, so a pending label cannot change the footer layout', () => {
  expect(renderLabels('idle').save).toEqual([
    { text: 'settings.save', shown: true },
    { text: 'settings.saving', shown: false },
  ]);
  expect(renderLabels('saving').save).toEqual([
    { text: 'settings.save', shown: false },
    { text: 'settings.saving', shown: true },
  ]);
  expect(renderLabels('testing').test).toEqual([
    { text: 'settings.providers.checkConnection', shown: false },
    { text: 'settings.testing', shown: true },
  ]);
});
