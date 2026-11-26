import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { translate } from '../../../../i18n/messages';
import { isTopOverlayLayer } from '../../../../lib/overlayStack';
import { ProvidersSettings } from './ProvidersSettings';
import type { LlmProviderEntry } from '@shared/types/settings';
vi.mock('../../../../i18n', () => ({
  useI18n: () => ({
    t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('en', key, params),
  }),
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function Sample() {
  const [entries, setEntries] = useState(() =>
    ['first', 'second'].map((id): LlmProviderEntry => ({
      id,
      label: id,
      authMode: 'api-key',
      category: 'official-direct',
      endpointClass: 'first-party',
      providerAvailability: { state: 'available' },
      status: 'verified',
      models: [],
      isConfigured: true,
      protocol: 'OpenAIResponses',
      lifecycleStatus: 'stable',
      serviceOperator: id,
      enabled: true,
      catalogOwnership: 'app-managed',
      catalogProvenance: [],
      recommendedModels: [],
      apiKey: '',
      hasStoredSecret: true,
    })),
  );
  return createElement(ProvidersSettings, {
    providerCatalog: entries,
    accountProviders: [],
    providerCatalogCategories: [],
    getResolvedProviderLabel: (provider) => provider.label,
    onOpenProviderConnection: () => undefined,
    onDisconnectProvider: (provider) =>
      setEntries((current) =>
        current.map((entry) => (entry.id === provider.id ? { ...entry, isConfigured: false } : entry)),
      ),
  });
}

const find = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
async function openMenu(id: string) {
  const trigger = find(`settings-provider-actions-${id}`);
  await act(async () => {
    trigger.focus();
    trigger.click();
  });
  expect(document.activeElement).toBe(find(`settings-provider-disconnect-${id}`));
  return trigger;
}

it('returns native Tab navigation to its trigger before the owning dialog handles the same key', async () => {
  await act(async () => root.render(createElement(Sample)));
  for (const shiftKey of [false, true]) {
    const trigger = await openMenu('first');
    const atParent = vi.fn(() => [document.activeElement, isTopOverlayLayer(null)]);
    document.addEventListener('keydown', atParent, { once: true });
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    await act(async () => {
      document.activeElement!.dispatchEvent(event);
    });
    expect(atParent.mock.results[0].value).toEqual([trigger, true]);
    expect(event.defaultPrevented).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  }
});

it('focuses the adjacent management action after removal and the directory search after the last removal', async () => {
  await act(async () => root.render(createElement(Sample)));
  await openMenu('first');
  await act(async () => {
    find('settings-provider-disconnect-first').click();
  });
  expect(document.activeElement).toBe(find('settings-provider-connect-second'));
  await openMenu('second');
  await act(async () => {
    find('settings-provider-disconnect-second').click();
  });
  expect(document.activeElement).toBe(find('settings-provider-search'));
});
