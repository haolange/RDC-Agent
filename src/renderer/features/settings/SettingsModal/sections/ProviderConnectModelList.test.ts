// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { translate } from '../../../../i18n/messages';
import { reconcileCatalogProviders, resetCatalogProjection } from '../../../../stores/effectiveCatalogStore';
import { ProviderConnectModelList } from './ProviderConnectModelList';
import type { EffectiveCatalogSnapshot } from '@shared/types/providerCapability';
import type { LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
vi.mock('../../../../i18n', () => ({
  useI18n: () => ({
    t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('en', key, params),
  }),
}));

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../../platform/getElectronApi', () => ({ getElectronApi: () => undefined }));
vi.mock('../../../../services/effectiveCatalogService', () => ({
  readEffectiveCatalog: read,
  refreshEffectiveCatalog: vi.fn(),
  observeEffectiveCatalog: () => () => undefined,
}));

afterEach(() => {
  resetCatalogProjection();
  read.mockReset();
  vi.unstubAllGlobals();
});

const provider: Pick<
  LlmProviderEntry,
  'id' | 'catalogOwnership' | 'activeAccountId' | 'protocol' | 'isConfigured' | 'serviceOperator' | 'authMode'
> = {
  id: 'draft-service',
  catalogOwnership: 'provider-managed',
  activeAccountId: undefined,
  protocol: 'OpenAICompatibleChatCompletions',
  isConfigured: false,
  serviceOperator: 'Draft',
  authMode: 'api-key',
};
const model: LlmProviderModel = { id: 'model-a', label: 'Model A', enabled: true, availability: 'available' };
const snapshot: EffectiveCatalogSnapshot = {
  scopeGeneration: 'scope',
  projectionVersion: 1,
  providerId: provider.id,
  accountId: `anonymous:${provider.id}`,
  protocol: provider.protocol,
  catalogRevision: 'revision',
  models: [],
  generatedAt: '2026-11-22T00:00:00Z',
  stale: false,
  refreshing: false,
};

it('asks for its draft catalog again after settings reconciliation drops it, so rows do not stay loading', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  read.mockResolvedValue(snapshot);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const badge = () =>
    host.querySelector('[data-testid="settings-provider-model-row-model-a"]')?.getAttribute('data-availability-badge');
  try {
    await act(async () =>
      root.render(
        createElement(ProviderConnectModelList, {
          provider,
          models: [model],
          expandedModelId: null,
          disabled: false,
          onToggleExpanded: () => {},
          onModelChange: () => {},
          onModelCountChange: () => {},
        }),
      ),
    );
    expect(badge()).toBe('available');
    await act(async () => {
      reconcileCatalogProviders([]);
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(badge()).toBe('available');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('keeps enabling a model independent from opening its capabilities, including when the model is unavailable', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  read.mockResolvedValue(snapshot);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const expand = vi.fn();
  const change = vi.fn();
  const render = (current: LlmProviderModel, opened: string | null) =>
    act(async () =>
      root.render(
        createElement(ProviderConnectModelList, {
          provider,
          models: [current],
          expandedModelId: opened,
          disabled: false,
          onToggleExpanded: expand,
          onModelChange: change,
          onModelCountChange: () => {},
        }),
      ),
    );
  try {
    await render(model, null);
    const toggle = () => host.querySelector<HTMLInputElement>('[role="switch"]')!;
    const details = () => host.querySelector<HTMLButtonElement>('[aria-expanded]')!;
    await act(async () => toggle().click());
    expect(change).toHaveBeenCalledWith(model.id, { ...model, enabled: false });
    expect(expand).not.toHaveBeenCalled();
    await render({ ...model, availability: 'unavailable' }, null);
    expect(toggle().disabled).toBe(true);
    await act(async () => details().click());
    expect(expand).toHaveBeenCalledWith(model.id);
    expect(details().getAttribute('aria-label')).toContain(model.label);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
