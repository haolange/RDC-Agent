import { describe, expect, it, vi } from 'vitest';
import type { EffectiveModel, RequestPlan, RequestPlanningResult } from '@shared/types/providerCapability';
import { providerAdapterIdForProtocol } from '@shared/provider-catalog/implementationRegistry';
import { createTestRequestPlan } from '../testing/createTestRequestPlan';
import type { LlmModelCapabilityProbeRequest, LlmProviderEntry } from '@shared/types/settings';
import type { AssistantMessage } from '../agent-runtime/core/types';
import {
  buildProbeFailurePatch,
  buildProbeSuccessPatch,
  classifyCapabilityProbeFailure,
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
    route: { protocol: 'OpenAIResponses', baseUrl: 'https://example.test/v1', source: 'catalog' },
    availability: 'available',
    presencePolicy: 'maintained',
    contextTiers: [{
      id: 'default', label: 'Default', maxPromptTokens: 272_000,
      activation: { kind: 'implicit' }, entitlement: 'granted',
    }],
    defaultBudgetTokens: 272_000,
    controls: {
      fast: { state: 'unsupported', fixedValue: false },
      maxContext: { state: 'unsupported', fixedValue: false },
      reasoning: {
        kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', lockedSelection: 'off',
        wireProfile: { kind: 'none' },
      },
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
  const maxTier = effectiveModel.contextTiers.at(-1)!;
  const requestPlan: RequestPlan = createTestRequestPlan({
    providerId: request.providerId,
    adapterId: providerAdapterIdForProtocol(effectiveModel.route.protocol),
    catalogRevision: effectiveModel.catalogRevision ?? 'test-catalog',
    routeRevision: effectiveModel.routeRevision ?? 'test-route',
    selectedModelId: request.modelId,
    effectiveModelId: request.modelId,
    appliedBindingIds: request.mode === 'fast' && effectiveModel.executionBindings?.[0]
      ? [effectiveModel.executionBindings[0].id]
      : [],
    route: effectiveModel.route,
    headers: request.mode === 'max-context' && maxTier.activation.kind === 'header'
      ? maxTier.activation.headers
      : {},
    bodyPatch: {},
    contextBudgetTokens: request.mode === 'max-context'
      ? Math.min(1_000_000, maxTier.maxPromptTokens ?? effectiveModel.defaultBudgetTokens)
      : effectiveModel.defaultBudgetTokens,
    contextMode: request.mode === 'max-context' ? 'one-million' : 'normal',
    contextWindowTokens: maxTier.maxTotalTokens
      ?? (maxTier.maxPromptTokens ?? effectiveModel.defaultBudgetTokens) + (maxTier.maxOutputTokens ?? 0),
    activeTierId: request.mode === 'max-context' ? maxTier.id : effectiveModel.contextTiers[0].id,
    fastMode: request.mode === 'fast',
    reasoningWire: { selection: 'off', control: effectiveModel.controls.reasoning },
  });
  return {
    ok: true,
    plan: requestPlan,
    controls: {
      reasoningLevel: 'off',
      maxContextMode: request.mode === 'max-context',
      fastModel: request.mode === 'fast',
    },
    warnings: [],
  };
}

function dependencies(effectiveModel: EffectiveModel) {
  const resolved = target(effectiveModel);
  const execute = vi.fn(async (): Promise<AssistantMessage> => ({
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    model: effectiveModel.modelId,
    provider: effectiveModel.providerId,
    usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
    stopReason: 'stop',
    timestamp: 1,
  }));
  const freezeCredentials = vi.fn(async () => 'credential-probe');
  const releaseCredentials = vi.fn();
  const recordSuccess = vi.fn();
  const recordFailure = vi.fn(() => false);
  const value: ProviderCapabilityProbeDependencies = {
    resolve: () => resolved,
    plan: (request) => plan(request, effectiveModel),
    execute,
    freezeCredentials,
    releaseCredentials,
    recordSuccess,
    recordFailure,
  };
  return { value, resolved, execute, freezeCredentials, releaseCredentials, recordSuccess, recordFailure };
}

describe('ProviderCapabilityProbeService', () => {
  it('executes a minimal default probe and records successful evidence', async () => {
    const fixture = dependencies(model({ availability: 'unknown' }));
    const service = new ProviderCapabilityProbeService(fixture.value);
    const request = { providerId: 'provider-a', modelId: 'model-a', mode: 'default' } as const;

    await expect(service.test(request)).resolves.toMatchObject({
      success: true,
      status: 'verified',
      requestSent: true,
      evidence: {
        protocol: 'OpenAIResponses',
        effectiveModelId: 'model-a',
        usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
      },
    });
    expect(fixture.execute).toHaveBeenCalledOnce();
    expect(fixture.execute).toHaveBeenCalledWith(expect.objectContaining({ credentialHandle: 'credential-probe' }));
    expect(fixture.releaseCredentials).toHaveBeenCalledWith('credential-probe');
    expect(fixture.recordSuccess).toHaveBeenCalledOnce();
  });

  it('does not grant Fast until the provider confirms usage.speed=fast', async () => {
    const effectiveModel = model({
      controls: {
        ...model().controls,
        fast: { state: 'selectable', defaultValue: false, entitlement: 'unknown' },
      },
      executionBindings: [{
        id: 'fast:priority',
        when: { fast: true },
        actions: [{ kind: 'request-patch', patch: { speed: 'fast' } }],
        entitlement: 'unknown',
      }],
    });
    const fixture = dependencies(effectiveModel);
    const service = new ProviderCapabilityProbeService(fixture.value);
    const request = { providerId: 'provider-a', modelId: 'model-a', mode: 'fast' } as const;

    await expect(service.test(request)).resolves.toMatchObject({
      success: false,
      status: 'inconclusive',
      requestSent: true,
      detail: expect.stringContaining('usage.speed=fast'),
      evidence: { usage: { totalTokens: 4 } },
    });
    expect(fixture.recordSuccess).not.toHaveBeenCalled();

    fixture.execute.mockResolvedValueOnce({
      role: 'assistant',
      content: [{ type: 'text', text: 'fast' }],
      model: 'model-a',
      provider: 'provider-a',
      usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4, speed: 'fast' },
      stopReason: 'stop',
      timestamp: 2,
    });
    await expect(service.test(request)).resolves.toMatchObject({
      success: true,
      status: 'verified',
      evidence: { usage: { speed: 'fast' } },
    });
    expect(fixture.recordSuccess).toHaveBeenCalledOnce();
  });
  it('reports credential freeze failure before any provider request is sent', async () => {
    const fixture = dependencies(model());
    fixture.freezeCredentials.mockRejectedValue(new Error('Credential lease unavailable'));
    const service = new ProviderCapabilityProbeService(fixture.value);

    await expect(service.test({
      providerId: 'provider-a', modelId: 'model-a', mode: 'default',
    })).resolves.toMatchObject({
      success: false, status: 'failed', requestSent: false,
    });
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.releaseCredentials).not.toHaveBeenCalled();
  });


  it('sends a real request for an implicit unknown Max tier instead of short-circuiting', async () => {
    const fixture = dependencies(model({
      contextTiers: [
        ...model().contextTiers,
        { id: 'long', label: 'Max', maxPromptTokens: 872_000, activation: { kind: 'implicit' }, entitlement: 'unknown' },
      ],
      controls: {
        ...model().controls,
        maxContext: { state: 'selectable', defaultValue: false, entitlement: 'unknown', tierId: 'long' },
      },
    }));
    const service = new ProviderCapabilityProbeService(fixture.value);

    await expect(service.test({ providerId: 'provider-a', modelId: 'model-a', mode: 'max-context' })).resolves.toMatchObject({
      success: true, status: 'verified', requestSent: true,
    });
    expect(fixture.execute).toHaveBeenCalledOnce();
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
      controls: {
        ...model().controls,
        maxContext: { state: 'selectable', defaultValue: false, entitlement: 'unknown', tierId: 'long' },
      },
    }));
    const service = new ProviderCapabilityProbeService(fixture.value);

    await expect(service.test({ providerId: 'provider-a', modelId: 'model-a', mode: 'max-context' })).resolves.toMatchObject({
      success: true, status: 'verified', requestSent: true,
    });
    expect(fixture.execute).toHaveBeenCalledOnce();
    expect(fixture.recordSuccess).toHaveBeenCalledOnce();
    expect(buildProbeSuccessPatch(
      { providerId: 'provider-a', modelId: 'model-a', mode: 'max-context' },
      fixture.resolved,
      plan({ providerId: 'provider-a', modelId: 'model-a', mode: 'max-context' }, fixture.resolved.model).plan,
    )).toMatchObject({
      modelId: 'model-a',
      controls: { maxContext: expect.objectContaining({ entitlement: 'granted' }) },
      contextTiers: expect.arrayContaining([expect.objectContaining({ id: 'long', entitlement: 'granted' })]),
    });
  });

  it('records a deterministic Fast denial for HTTP 403', async () => {
    const effectiveModel = model({
      controls: {
        ...model().controls,
        fast: { state: 'selectable', defaultValue: false, entitlement: 'unknown' },
      },
      executionBindings: [{
        id: 'fast:priority', when: { fast: true },
        actions: [{ kind: 'request-patch', patch: { service_tier: 'priority' } }], entitlement: 'unknown',
      }],
    });
    const fixture = dependencies(effectiveModel);
    fixture.execute.mockRejectedValue(Object.assign(new Error('HTTP 403'), { status: 403 }));
    fixture.recordFailure.mockReturnValue(true);
    const service = new ProviderCapabilityProbeService(fixture.value);
    const request = { providerId: 'provider-a', modelId: 'model-a', mode: 'fast' } as const;

    await expect(service.test(request)).resolves.toMatchObject({
      success: false, status: 'denied', requestSent: true,
    });
    expect(fixture.recordFailure).toHaveBeenCalledWith(request, fixture.resolved, expect.any(Object), 403, 'HTTP 403');
    expect(buildProbeFailurePatch(request, fixture.resolved, plan(request, effectiveModel).plan, 403, true)).toMatchObject({
      modelId: 'model-a', controls: { fast: { entitlement: 'denied' } },
    });
    expect(buildProbeSuccessPatch(request, fixture.resolved, plan(request, effectiveModel).plan)).toMatchObject({
      modelId: 'model-a',
      controls: { fast: { entitlement: 'granted' } },
      executionBindings: [expect.objectContaining({ id: 'fast:priority', entitlement: 'granted' })],
    });
  });

  it('keeps an undeclared HTTP 403 fail-closed instead of inventing entitlement evidence', () => {
    const effectiveModel = model({
      controls: {
        ...model().controls,
        fast: { state: 'selectable', defaultValue: false, entitlement: 'unknown' },
      },
    });
    const request = { providerId: 'provider-a', modelId: 'model-a', mode: 'fast' } as const;

    expect(buildProbeFailurePatch(request, target(effectiveModel), plan(request, effectiveModel).plan, 403)).toBeNull();
  });

  it('accepts a manifest-matched HTTP 401 as entitlement denial without changing generic 401 classification', () => {
    expect(classifyCapabilityProbeFailure(401)).toBe('authentication-failed');
    expect(classifyCapabilityProbeFailure(401, true)).toBe('entitlement-denied');
  });

  it('classifies only an explicit HTTP 402 quota response as transient quota exhaustion', () => {
    expect(classifyCapabilityProbeFailure(402, false, 'quota_exceeded')).toBe('quota-exhausted');
    expect(classifyCapabilityProbeFailure(402, false, 'payment required')).toBe('unknown');
  });

  it('never turns HTTP 401 authentication failure into entitlement evidence', () => {
    const effectiveModel = model({
      controls: {
        ...model().controls,
        fast: { state: 'selectable', defaultValue: false, entitlement: 'unknown' },
      },
      executionBindings: [{
        id: 'fast:model-a-highspeed', when: { fast: true },
        actions: [{ kind: 'model-switch', targetModelId: 'model-a-highspeed' }], entitlement: 'unknown',
      }],
    });
    const request = { providerId: 'provider-a', modelId: 'model-a', mode: 'fast' } as const;
    const basePlan = plan(request, effectiveModel).plan;
    const switchedPlan = {
      ...basePlan,
      effectiveModelId: 'model-a-highspeed',
    };

    expect(buildProbeFailurePatch(request, target(effectiveModel), switchedPlan, 401)).toBeNull();
    expect(buildProbeFailurePatch(request, target(effectiveModel), basePlan, 401)).toBeNull();
  });

  it('does not downgrade capability evidence for a transient HTTP 429', async () => {
    const effectiveModel = model({
      controls: {
        ...model().controls,
        fast: { state: 'selectable', defaultValue: false, entitlement: 'unknown' },
      },
      executionBindings: [{
        id: 'fast:priority', when: { fast: true },
        actions: [{ kind: 'request-patch', patch: { service_tier: 'priority' } }], entitlement: 'unknown',
      }],
    });
    const fixture = dependencies(effectiveModel);
    fixture.execute.mockRejectedValue(Object.assign(new Error('HTTP 429'), { status: 429 }));
    const service = new ProviderCapabilityProbeService(fixture.value);
    const request = { providerId: 'provider-a', modelId: 'model-a', mode: 'fast' } as const;

    await expect(service.test(request)).resolves.toMatchObject({
      success: false, status: 'failed', requestSent: true,
    });
    expect(fixture.recordFailure).toHaveBeenCalledWith(request, fixture.resolved, expect.any(Object), 429, 'HTTP 429');
    expect(buildProbeFailurePatch(request, fixture.resolved, plan(request, effectiveModel).plan, 429)).toBeNull();
  });
});
