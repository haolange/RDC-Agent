// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { translate } from '../../../../i18n/messages';
import { reconcileCatalogProviders, resetCatalogProjection } from '../../../../stores/effectiveCatalogStore';
import { ProviderConnectModelList } from './ProviderConnectModelList';
import type { EffectiveCatalogSnapshot } from '@shared/types/providerCapability';
import type { LlmProviderModel } from '@shared/types/settings';

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../../platform/getElectronApi', () => ({ getElectronApi: () => undefined }));
vi.mock('../../../../services/effectiveCatalogService', () => ({
  readEffectiveCatalog: read, refreshEffectiveCatalog: vi.fn(), observeEffectiveCatalog: () => () => undefined,
}));

afterEach(() => { resetCatalogProjection(); read.mockReset(); vi.unstubAllGlobals(); });

const provider = { id: 'draft-service', catalogOwnership: 'discovered' as const, activeAccountId: undefined, protocol: 'OpenAIChatCompletions' as const,
  isConfigured: false, serviceOperator: undefined, authMode: 'api_key' as const };
const model: LlmProviderModel = { id: 'model-a', label: 'Model A', enabled: true, availability: 'available' };
const snapshot: EffectiveCatalogSnapshot = {
  scopeGeneration: 'scope', projectionVersion: 1, providerId: provider.id, accountId: `anonymous:${provider.id}`,
  protocol: provider.protocol, catalogRevision: 'revision', models: [], generatedAt: '2026-11-22T00:00:00Z', stale: false, refreshing: false,
};

it('asks for its draft catalog again after settings reconciliation drops it, so rows do not stay loading', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  read.mockResolvedValue(snapshot);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const badge = () => host.querySelector('[data-testid="settings-provider-model-row-model-a"]')?.getAttribute('data-availability-badge');
  try {
    await act(async () => root.render(createElement(ProviderConnectModelList, {
      provider, models: [model], expandedModelId: null, disabled: false,
      onToggleExpanded: () => {}, onModelChange: () => {}, onModelCountChange: () => {},
      t: (key, params) => translate('en', key, params),
    })));
    expect(badge()).toBe('available');
    await act(async () => { reconcileCatalogProviders([]); });
    expect(read).toHaveBeenCalledTimes(2);
    expect(badge()).toBe('available');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
