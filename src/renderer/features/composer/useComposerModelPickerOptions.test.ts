// @vitest-environment happy-dom
import { act, createElement as h, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';
import type { LlmProviderEntry } from '@shared/types/settings';
import { resetCatalogProjection, useEffectiveCatalogStore } from '../../stores/effectiveCatalogStore';
import { useComposerModelPickerOptions } from './useComposerModelPickerOptions';

const { read, refresh } = vi.hoisted(() => ({ read: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../platform/getElectronApi', () => ({ getElectronApi: () => undefined }));
vi.mock('../../services/effectiveCatalogService', () => ({ readEffectiveCatalog: read, refreshEffectiveCatalog: refresh, observeEffectiveCatalog: () => () => undefined }));
const providers = ['fast', 'slow'].map((id) => ({ id, label: id, enabled: true, isConfigured: true, protocol: 'OpenAIResponses' })) as LlmProviderEntry[];
function catalog(providerId: string): EffectiveCatalogSnapshot {
  return { providerId, accountId: `anonymous:${providerId}`, protocol: 'OpenAIResponses', catalogRevision: 'r',
    scopeGeneration: 'fixture', projectionVersion: 1,
    generatedAt: '2026-10-25T00:00:00Z', stale: false, refreshing: false, models: [{
      providerId, modelId: 'model', label: providerId, aliases: [], enabled: true, availability: 'available',
      route: { protocol: 'OpenAIResponses', source: 'catalog' }, contextTiers: [],
      presencePolicy: 'maintained', defaultBudgetTokens: 8192, provenance: [],
      visionInput: { state: 'unsupported' }, structuredOutput: { state: 'unsupported' },
      controls: { fast: { state: 'unsupported', fixedValue: false }, maxContext: { state: 'unsupported', fixedValue: false },
        reasoning: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } } },
      toolCalling: { state: 'supported' },
    } satisfies EffectiveModel] };
}
function Consumer({ name, connections = providers }: { name: string; connections?: LlmProviderEntry[] }) {
  const { options, failedProviders, retry, loading, unavailableProviders = [] } = useComposerModelPickerOptions(connections);
  return h('section', { 'data-consumer': name, 'aria-busy': loading },
    ...options.map((row) => h('span', { key: row.providerId }, row.providerLabel)),
    ...failedProviders.map((row) => h('button', { key: row.id, onClick: () => retry(row.id) }, row.error)),
    ...unavailableProviders.map((row) => h('p', { key: row.id, 'data-pending-provider': row.id }, `${row.label}:${row.loading}`)));
}
it('keeps a configured Grok subscription visible while its models refresh and after an empty directory', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); resetCatalogProjection(); read.mockReset();
  const grok = { ...providers[0], id: 'grok-account', label: 'Grok Subscription' };
  read.mockImplementation((_api, id) => Promise.resolve(id === grok.id
    ? { ...catalog(id), refreshing: true, models: catalog(id).models.map(model => ({ ...model, availability: 'unknown' })) }
    : catalog(id)));
  const host = document.createElement('div'); const root = createRoot(host);
  try {
    await act(async () => root.render(h(Consumer, { name: 'picker', connections: [providers[0], grok] })));
    expect(host.textContent).toContain('fast');
    expect(host.querySelector('[data-pending-provider="grok-account"]')?.textContent).toBe('Grok Subscription:true');
    await act(async () => useEffectiveCatalogStore.getState().accept({ ...catalog(grok.id), projectionVersion: 2, models: [], generatedAt: '2026-11-02T00:00:00Z' }));
    expect(host.querySelector('[data-pending-provider="grok-account"]')?.textContent).toBe('Grok Subscription:false');
  } finally { await act(async () => root.unmount()); resetCatalogProjection(); vi.unstubAllGlobals(); }
});
it('shares requests across mounted consumers and remounted menus, renders incrementally and retries only the failed provider', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); resetCatalogProjection(); read.mockReset();
  let failSlow!: (error: Error) => void;
  read.mockImplementation((_api, id) => id === 'fast' ? Promise.resolve(catalog(id))
    : new Promise((_resolve, reject) => { failSlow = reject; }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const render = (menu: boolean) => act(async () => root.render(h(Fragment, null, h(Consumer, { name: 'pill' }), menu ? h(Consumer, { name: 'menu' }) : null)));
  try {
    await render(true);
    expect(read).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-consumer="menu"] span')?.textContent).toBe('fast');
    expect(host.querySelector('[data-pending-provider="slow"]')?.textContent).toBe('slow:true');
    await act(async () => failSlow(new Error('offline')));
    expect(host.querySelector('[data-consumer="menu"] button')?.textContent).toBe('offline');
    await render(false); await render(true);
    expect(read).toHaveBeenCalledTimes(2);
    read.mockImplementation((_api, id) => Promise.resolve(catalog(id)));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-consumer="menu"] button')!.click());
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls[2][1]).toBe('slow');
    expect(host.querySelector('[data-consumer="menu"]')?.textContent).toBe('fastslow');
  } finally {
    await act(async () => root.unmount()); host.remove(); resetCatalogProjection(); vi.unstubAllGlobals();
  }
});

it('removes disabled and disconnected providers immediately despite a cached catalog and restores the same selection set', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); resetCatalogProjection(); read.mockReset();
  read.mockImplementation((_api, id) => Promise.resolve(catalog(id)));
  const host = document.createElement('div'); const root = createRoot(host);
  const paint = (connections: LlmProviderEntry[]) => act(async () => root.render(h(Consumer, { name: 'picker', connections })));
  try {
    await paint(providers); expect(host.textContent).toBe('fastslow');
    await paint(providers.map((provider, index) => index === 0 ? { ...provider, enabled: false } : { ...provider, isConfigured: false }));
    expect(host.textContent).toBe('');
    await paint(providers); expect(host.textContent).toBe('fastslow');
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount()); resetCatalogProjection(); vi.unstubAllGlobals();
  }
});
