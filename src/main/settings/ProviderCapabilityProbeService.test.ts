import { describe, expect, it, vi } from 'vitest';
import type { EffectiveModel, RequestPlan, RequestPlanningResult } from '@shared/types/providerCapability';
import type { LlmModelCapabilityProbeRequest, LlmProviderEntry } from '@shared/types/settings';
import {
  buildProbeFailurePatch,
  ProviderCapabilityProbeService,
  type ProviderCapabilityProbeDependencies,
  type ResolvedProbeTarget,
} from './ProviderCapabilityProbeService';

function model(overrides: Partial<EffectiveModel> = {}): EffectiveModel {
  return {
    providerId: 'provider-a',
    modelId: 'model-a',
    label: 'Model A',
    aliases: [],
    enabled: true,
    route: { protocol: 'OpenAIResponses', baseUrl: 'https://example.test/v1', source: 'preset' },
    availability: 'available',
    contextTiers: [{
      id: 'default', label: 'Default', maxPromptTokens: 272_000,
      activation: { kind: 'implicit' }, entitlement: 'granted',
    }],
    defaultBudgetTokens: 272_000,
    fast: { kind: 'unsupported' },
    reasoning: {
      kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', lockedSelection: 'off',
      wireProfile: { kind: 'none' },
    },
    toolCalling: { state: 'supported' },
    visionInput: { state: 'unknown' },
    structuredOutput: { state: 'supported' },
    provenance: [],
    ...overrides,
  };
}

function target(effectiveModel: EffectiveModel): ResolvedProbeTarget {
  return {
    provider: {
      id: effectiveModel.providerId,
      activeAccountId: 'account-a',
      protocol: effectiveModel.route.protocol,
      isConfigured: true,
    } as LlmProviderEntry,
    model: effectiveModel,
  };
}

function plan(
  request: LlmModelCapabilityProbeRequest,
  effectiveModel: EffectiveModel,
): Extract<RequestPlanningResult, { ok: true }> {
  const oneMillionTier = effectiveModel.contextTiers.at(-1)!;
  const requestPlan: RequestPlan = {
    providerId: request.providerId,
    effectiveModelId: request.modelId,
    route: effectiveModel.route,
    headers: request.mode === 'one-million-context' && oneMillionTier.activation.kind === 'header'
      ? oneMillionTier.activation.headers
      : {},
    bodyPatch: {},
    contextBudgetTokens: request.mode === 'one-million-context'
      ? Math.min(1_000_000, oneMillionTier.maxPromptTokens ?? effectiveModel.defaultBudgetTokens)
      : effectiveModel.defaultBudgetTokens,
    contextMode: request.mode === 'one-million-context' ? 'one-million' : 'normal',
    contextWindowTokens: oneMillionTier.maxTotalTokens
      ?? (oneMillionTier.maxPromptTokens ?? effectiveModel.defaultBudgetTokens) + (oneMillionTier.maxOutputTokens ?? 0),
    activeTierId: request.mode === 'one-million-context' ? oneMillionTier.id : effectiveModel.contextTiers[0].id,
    fastMode: request.mode === 'fast',
    reasoningWire: { selection: 'off', control: effectiveModel.reasoning },
  };
  return {
    ok: true,
    plan: requestPlan,
    controls: {
      reasoningLevel: 'off',
      maxContextMode: request.mode === 'one-million-context',
      fastModel: request.mode === 'fast',
    },
    warnings: [],
  };
}

function dependencies(effectiveModel: EffectiveModel) {
  const resolved = target(effectiveModel);
  const execute = vi.fn(async () => ({} as never));
  const recordSuccess = vi.fn();
  const recordFailure = vi.fn(() => false);
  const value: ProviderCapabilityProbeDependencies = {
    resolve: () => resolved,
    plan: (request) => plan(request, effectiveModel),
    execute,
    recordSuccess,
    recordFailure,
  };
  return { value, resolved, execute, recordSuccess, recordFailure };
}

describe('ProviderCapabilityProbeService', () => {
  it('executes a minimal default probe and records successful evidence', async () => {
    const fixture = dependencies(model({ availability: 'unknown' }));
    const service = new ProviderCapabilityProbeService(fixture.value);
    const request = { providerId: 'provider-a', modelId: 'model-a', mode: 'default' } as const;

    await expect(service.test(request)).resolves.toEqual({
      success: true, status: 'verified', requestSent: true,
    });
    expect(fixture.execute).toHaveBeenCalledOnce();
    expect(fixture.recordSuccess).toHaveBeenCalledOnce();
  });

  it('keeps an implicit unknown 1M tier inconclusive without sending a fake proof request', async () => {
    const fixture = dependencies(model({
      contextTiers: [
        ...model().contextTiers,
        { id: 'long', label: '1M', maxPromptTokens: 922_000, maxOutputTokens: 128_000, activation: { kind: 'implicit' }, entitlement: 'unknown' },
      ],
    }));
    const service = new ProviderCapabilityProbeService(fixture.value);

    await expect(service.test({ providerId: 'provider-a', modelId: 'model-a', mode: 'one-million-context' })).resolves.toMatchObject({
      success: false, status: 'inconclusive', requestSent: false,
    });
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it('sends and records an explicit header-activated unknown 1M tier probe', async () => {
    const fixture = dependencies(model({
      contextTiers: [
        ...model().contextTiers,
        {
          id: 'long', label: '1M', maxPromptTokens: 1_000_000,
          activation: { kind: 'header', headers: { 'anthropic-beta': 'context-1m' } }, entitlement: 'unknown',
        },
      ],
    }));
    const service = new ProviderCapabilityProbeService(fixture.value);

    await expect(service.test({ providerId: 'provider-a', modelId: 'model-a', mode: 'one-million-context' })).resolves.toMatchObject({
      success: true, status: 'verified', requestSent: true,
    });
    expect(fixture.execute).toHaveBeenCalledOnce();
    expect(fixture.recordSuccess).toHaveBeenCalledOnce();
  });

  it('records a deterministic Fast denial for HTTP 403', async () => {
    const effectiveModel = model({ fast: { kind: 'request-param', patch: { service_tier: 'priority' }, entitlement: 'unknown' } });
    const fixture = dependencies(effectiveModel);
    fixture.execute.mockRejectedValue(Object.assign(new Error('HTTP 403'), { status: 403 }));
    fixture.recordFailure.mockReturnValue(true);
    const service = new ProviderCapabilityProbeService(fixture.value);
    const request = { providerId: 'provider-a', modelId: 'model-a', mode: 'fast' } as const;

    await expect(service.test(request)).resolves.toMatchObject({
      success: false, status: 'denied', requestSent: true,
    });
    expect(fixture.recordFailure).toHaveBeenCalledWith(request, fixture.resolved, expect.any(Object), 403);
    expect(buildProbeFailurePatch(request, fixture.resolved, plan(request, effectiveModel).plan, 403)).toMatchObject({
      modelId: 'model-a', fast: { entitlement: 'denied' },
    });
  });

  it('does not downgrade capability evidence for a transient HTTP 429', async () => {
    const effectiveModel = model({ fast: { kind: 'request-param', patch: { service_tier: 'priority' }, entitlement: 'unknown' } });
    const fixture = dependencies(effectiveModel);
    fixture.execute.mockRejectedValue(Object.assign(new Error('HTTP 429'), { status: 429 }));
    const service = new ProviderCapabilityProbeService(fixture.value);
    const request = { providerId: 'provider-a', modelId: 'model-a', mode: 'fast' } as const;

    await expect(service.test(request)).resolves.toMatchObject({
      success: false, status: 'failed', requestSent: true,
    });
    expect(fixture.recordFailure).toHaveBeenCalledWith(request, fixture.resolved, expect.any(Object), 429);
    expect(buildProbeFailurePatch(request, fixture.resolved, plan(request, effectiveModel).plan, 429)).toBeNull();
  });
});
