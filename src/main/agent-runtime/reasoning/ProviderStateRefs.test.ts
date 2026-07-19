import { describe, expect, it } from 'vitest';
import type { ProviderContractBundle } from '@shared/provider-catalog/modelManifestSchema';
import type { RequestPlan } from '@shared/types/providerCapability';
import { createFailClosedProviderContracts } from '@shared/provider-catalog/providerContracts';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import type { Context } from '../core/types';
import {
  createProviderStateRef,
  findLatestProviderState,
  providerStateReuseReason,
  verifyProviderStateRef,
} from './ProviderStateRefs';

function plan(
  modelId: string,
  crossModel: ProviderContractBundle['state']['crossModel'] = 'never',
): RequestPlan {
  const fallback = createFailClosedProviderContracts('OpenAIResponses');
  const contracts: ProviderContractBundle = {
    ...fallback,
    protocolDialect: 'OpenAIResponses',
    protocolVersion: 'v1',
    compatibilityGroup: 'provider:responses',
    state: {
      supportedModes: ['local-stateless', 'provider-managed'],
      defaultMode: 'provider-managed',
      carrier: 'previous-response-id',
      retention: 'provider',
      crossModel,
    },
  };
  return createTestRequestPlan({
    providerId: 'provider',
    adapterId: 'openai-responses',
    catalogRevision: 'catalog',
    routeRevision: 'route',
    selectedModelId: modelId,
    effectiveModelId: modelId,
    appliedBindingIds: [],
    route: {
      protocol: 'OpenAIResponses',
      baseUrl: 'https://provider.test/v1',
      source: 'catalog',
      contracts,
    },
    contracts,
    statePlan: {
      mode: 'provider-managed',
      carrier: 'previous-response-id',
      store: true,
      reuseProviderState: true,
    },
    headers: {},
    bodyPatch: {},
    contextBudgetTokens: 128_000,
    contextMode: 'normal',
    contextWindowTokens: 128_000,
    activeTierId: 'default',
    fastMode: false,
    reasoningWire: {
      selection: 'off',
      control: {
        kind: 'none',
        supportsOff: true,
        levels: [],
        defaultSelection: 'off',
        wireProfile: { kind: 'none' },
      },
    },
  });
}

describe('ProviderStateRefs', () => {
  it('creates integrity-bound main-process state and rejects tampering', () => {
    const state = createProviderStateRef(plan('model-a'), ' response_1 ');
    expect(state).toMatchObject({
      schemaVersion: 1,
      carrier: 'previous-response-id',
      value: 'response_1',
      originFingerprint: 'test-execution',
    });
    expect(verifyProviderStateRef(state!)).toBe(true);
    expect(verifyProviderStateRef({ ...state!, value: 'response_2' })).toBe(false);
  });

  it('enforces exact provider boundaries before applying cross-model policy', () => {
    const source = plan('model-a', 'provider-managed');
    const state = createProviderStateRef(source, 'response_1');
    const target = plan('model-b', 'provider-managed');
    expect(providerStateReuseReason(state, target)).toBe('reusable');

    const otherEndpoint: RequestPlan = {
      ...target,
      executionIdentity: {
        ...target.executionIdentity,
        endpointHash: 'different-endpoint',
        fingerprint: 'different-target',
      },
    };
    expect(providerStateReuseReason(state, otherEndpoint)).toBe('provider-boundary-mismatch');
  });

  it('supports same-group switching while never-policy remains model-bound', () => {
    const state = createProviderStateRef(plan('model-a', 'same-compatibility-group'), 'response_1');
    expect(providerStateReuseReason(state, plan('model-b', 'same-compatibility-group'))).toBe('reusable');
    expect(providerStateReuseReason(state, plan('model-b', 'never'))).toBe('model-mismatch');

    const otherGroup = plan('model-b', 'same-compatibility-group');
    otherGroup.executionIdentity = {
      ...otherGroup.executionIdentity,
      compatibilityGroup: 'other-group',
      fingerprint: 'other-group-target',
    };
    expect(providerStateReuseReason(state, otherGroup)).toBe('compatibility-group-mismatch');
  });

  it('selects the latest compatible assistant anchor and skips incompatible state', () => {
    const target = plan('model-a');
    const compatible = createProviderStateRef(target, 'response_compatible')!;
    const incompatiblePlan = {
      ...target,
      executionIdentity: {
        ...target.executionIdentity,
        endpointHash: 'other-endpoint',
        fingerprint: 'other-execution',
      },
    };
    const incompatible = createProviderStateRef(incompatiblePlan, 'response_incompatible')!;
    const context: Context = {
      messages: [
        { role: 'user', content: 'first', timestamp: 1 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'one' }],
          model: 'model-a',
          provider: 'provider',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          stopReason: 'stop',
          providerState: compatible,
          timestamp: 2,
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'two' }],
          model: 'model-a',
          provider: 'provider',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          stopReason: 'stop',
          providerState: incompatible,
          timestamp: 3,
        },
        { role: 'user', content: 'next', timestamp: 4 },
      ],
    };

    expect(findLatestProviderState(context, target)).toEqual({
      state: compatible,
      assistantMessageIndex: 1,
    });
  });
});
