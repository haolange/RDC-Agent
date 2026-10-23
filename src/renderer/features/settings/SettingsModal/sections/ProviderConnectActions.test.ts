// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { LlmProviderEntry } from '@shared/types/settings';
import { createProviderConnectionDraft } from '../providerConnectionState';
import { ProviderConnectActions } from './ProviderConnectActions';

it('allows testing a stored account credential without claiming it is verified or permitting save', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const provider = {
    id: 'chatgpt-account', authMode: 'account', models: [], isConfigured: false,
    hasStoredSecretByAuthMode: { account: true }, providerAvailability: { state: 'available' },
  } as unknown as LlmProviderEntry;
  const test = vi.fn(), save = vi.fn();
  const render = () => act(() => root.render(createElement(ProviderConnectActions, {
    draft: createProviderConnectionDraft(provider), provider, accountConnected: false,
    devicePending: false, needsCredentials: false, needsBaseUrl: false, hasFreshTest: false,
    onClose: vi.fn(), onTest: test, onSave: save, t: ((key: string) => key) as never,
  })));
  try {
    render();
    const testButton = host.querySelector<HTMLButtonElement>('[data-testid="settings-provider-connect-test"]')!;
    expect(testButton.disabled).toBe(false);
    act(() => testButton.click()); expect(test).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="settings-provider-connect-save"]')!.disabled).toBe(true);
    provider.hasStoredSecretByAuthMode = { account: false }; render();
    expect(testButton.disabled).toBe(true);
    expect(save).not.toHaveBeenCalled(); expect(provider.isConfigured).toBe(false);
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
