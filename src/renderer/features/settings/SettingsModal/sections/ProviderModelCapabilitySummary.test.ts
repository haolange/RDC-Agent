// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { translate } from '../../../../i18n/messages';
import { ProviderModelCapabilitySummary, type ProviderModelCapabilitySummaryProps } from './ProviderModelCapabilitySummary';
import { testModelCapability } from './providerCatalogActions';
import { providerProbeResultText } from './providerProbeResultText';
import type { EffectiveModel } from '@shared/types/providerCapability';
vi.mock('./providerCatalogActions', () => ({ testModelCapability: vi.fn() }));

it.each([
  ['en', 'The provider reported default; actual Fast processing is unconfirmed.'],
  ['zh-CN', '服务端回报 default，实际 Fast 状态未确认。'],
] as const)('says what a Fast probe found in %s, without the raw tier receipt', (language, detail) => {
  const text = providerProbeResultText({
    success: false,
    status: 'inconclusive',
    requestSent: true,
    detailCode: 'fast-tier-default',
    evidence: {
      protocol: 'OpenAIResponses',
      effectiveModelId: 'gpt-6.1-terra',
      observedAt: '2026-11-05T05:32:53.918Z',
      requestedServiceTier: 'priority',
      serviceTier: 'default',
      usage: { inputTokens: 31, outputTokens: 5, totalTokens: 36 },
    },
  }, (key, params) => translate(language, key, params));
  expect(text).toEqual({ status: expect.any(String), detail });
});

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


it('shows warnings, tiers and the probe in the expanded model, and the probe outcome in words', async () => {
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
    // The expanded model is already the detail layer: nothing in it folds again.
    expect(host.querySelector('details')).toBeNull();
    expect(host.querySelector('[data-testid="settings-provider-tool-calling-unverified"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="settings-provider-model-tiers-model-a"]')).not.toBeNull();
    expect(host.textContent).toContain('Unavailable route');
    expect(host.textContent).not.toMatch(/settings\.providers\.capability\.(sources|protocolOwner|activation)/u);
    const probe = host.querySelector<HTMLButtonElement>('[data-testid="settings-provider-model-probe-model-a"] .settings-model-capability-probe-actions button')!;
    await act(async () => probe.click());
    expect(host.querySelector('[role="status"]')?.textContent).toContain('inconclusive');
    // The raw probe detail is not printed; only a known reason would be.
    expect(host.textContent).not.toContain('Need actual threshold evidence');
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
