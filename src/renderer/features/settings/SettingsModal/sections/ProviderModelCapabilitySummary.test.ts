// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { ProviderModelCapabilitySummary, type ProviderModelCapabilitySummaryProps } from './ProviderModelCapabilitySummary';
import { testModelCapability } from './providerCatalogActions';
vi.mock('./providerCatalogActions', () => ({ testModelCapability: vi.fn() }));
const reasoning = {
  kind: 'toggle' as const,
  supportsOff: true,
  levels: [],
  defaultSelection: 'on' as const,
  wireProfile: { kind: 'anthropic' as const, on: 'high' as const, onMode: 'enabled' as const, offMode: 'disabled' as const },
};

function model(overrides: Partial<EffectiveModel> = {}): EffectiveModel {
  return {
    providerId: 'provider-a',
    modelId: 'model-a',
    label: 'Model A',
    aliases: [],
    enabled: true,
    route: { protocol: 'AnthropicMessages', source: 'catalog' },
    availability: 'available',
    presencePolicy: 'maintained',
    contextTiers: [{
      id: 'default', label: 'Default', maxPromptTokens: 262_144,
      activation: { kind: 'implicit' }, entitlement: 'granted',
    }],
    defaultBudgetTokens: 262_144,
    controls: {
      fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' },
      maxContext: { state: 'unsupported', fixedValue: false },
      reasoning,
    },
    executionBindings: [{
      id: 'fast:model-a-fast', when: { fast: true },
      actions: [{ kind: 'model-switch', targetModelId: 'model-a-fast' }], entitlement: 'granted',
    }],
    resolvedControls: {
      fast: { state: 'selectable', value: false, defaultValue: false, disabled: false, bindingId: 'fast:model-a-fast', effectiveModelId: 'model-a-fast' },
      maxContext: { state: 'unsupported', value: false, defaultValue: false, disabled: true },
      reasoning,
    },
    toolCalling: { state: 'supported' },
    visionInput: { state: 'unknown' },
    structuredOutput: { state: 'unknown' },
    provenance: [],
    ...overrides,
  };
}


it('keeps warnings outside collapsed details and shows an inconclusive probe after collapsing', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onModelChange = vi.fn();
  const effectiveModel = model({ toolCalling: { state: 'unknown' }, unavailableReason: 'Unavailable route' });
  const props: ProviderModelCapabilitySummaryProps = {
    provider: { id: 'provider-a', isConfigured: true, protocol: 'AnthropicMessages', serviceOperator: 'anthropic', authMode: 'api-key', catalogOwnership: 'app-managed' },
    model: { id: 'model-a', label: 'Model A', enabled: true },
    effectiveModel, snapshot: null, loading: false, loadFailed: false, onModelChange, t: (key) => key,
  };
  vi.mocked(testModelCapability).mockResolvedValue({ success: false, status: 'inconclusive', requestSent: true, detail: 'Need actual threshold evidence' });
  try {
    await act(async () => root.render(createElement(ProviderModelCapabilitySummary, props)));
    const details = host.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(host.querySelector('[data-testid="settings-provider-tool-calling-unverified"]')?.closest('details')).toBeNull();
    expect(host.textContent).toContain('Unavailable route');
    await act(async () => host.querySelector('summary')!.click());
    expect(details.open).toBe(true);
    const probe = host.querySelector<HTMLButtonElement>('[data-testid="settings-provider-model-probe-model-a"] button')!;
    await act(async () => probe.click());
    await act(async () => host.querySelector('summary')!.click());
    expect(host.querySelector('[role="status"]')?.closest('details')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('inconclusive');
    expect(testModelCapability).toHaveBeenCalledWith({providerId: 'provider-a', modelId: 'model-a', mode: 'default'});
    const select = host.querySelector<HTMLButtonElement>('[data-testid="settings-model-reasoning-model-a"]')!;
    await act(async () => select.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((el) => el.textContent?.includes('levelOn'))!;
    await act(async () => option.click());
    expect(onModelChange).toHaveBeenCalledWith({ defaultReasoningSelection: 'on' });
    await act(async () => root.render(createElement(ProviderModelCapabilitySummary, {
      ...props, effectiveModel: model({ controls: { ...effectiveModel.controls, reasoning: { kind: 'unknown', supportsOff: false, levels: [], defaultSelection: 'off', wireProfile: {kind: 'none'} } } }),
    })));
    expect(host.querySelector<HTMLButtonElement>('[data-testid="settings-model-reasoning-model-a"]')!.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
