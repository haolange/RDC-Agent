import { buildProbeFailurePatch, buildProbeSuccessPatch, classifyCapabilityProbeFailure } from './ProviderProbeEvidence';
import { describe, expect, it, vi } from 'vitest';
import type { EffectiveModel, RequestPlan, RequestPlanningResult } from '@shared/types/providerCapability';
import { providerAdapterIdForProtocol } from '@shared/provider-catalog/implementationRegistry';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import type { LlmModelCapabilityProbeRequest, LlmProviderEntry } from '@shared/types/settings';
import type { AssistantMessage } from '../../agent-runtime/core/types';
import {
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
    bodyPatch: request.mode === 'fast' && effectiveModel.executionBindings?.[0]?.actions[0]?.kind === 'request-patch'
      ? effectiveModel.executionBindings[0].actions[0].patch : {},
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
      detail: expect.stringContaining('selected Fast speed or target model'),
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
      success: false, status: 'inconclusive', requestSent: true,
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


describe('capability evidence and lifecycle', () => {
  it.each([
    ['default', 'fast-tier-default'],
    [undefined, 'fast-tier-missing'],
    ['flex', 'fast-tier-other'],
  ] as const)('keeps requested priority distinct from the returned tier %s', async (serviceTier, detailCode) => {
    const m = model();
    m.controls.fast = { state: 'selectable', defaultValue: false, entitlement: 'granted' };
    m.executionBindings = [{
      id: 'fast', when: { fast: true }, entitlement: 'granted',
      actions: [{ kind: 'request-patch', patch: { service_tier: 'priority' } }],
    }];
    const f = dependencies(m);
    const response = await f.execute();
    f.execute.mockResolvedValue({ ...response, execution: { serviceTier } });
    await expect(new ProviderCapabilityProbeService(f.value).test({ providerId: 'provider-a', modelId: 'model-a', mode: 'fast' }))
      .resolves.toMatchObject({
        status: 'inconclusive', detailCode, requestSent: true,
        evidence: { requestedServiceTier: 'priority', serviceTier },
      });
    expect(f.recordSuccess).not.toHaveBeenCalled();
    expect(f.recordFailure).not.toHaveBeenCalled();
  });

  it.each(['priority', 'target'] as const)('uses the %s binding response instead of Anthropic-only speed', async kind => {
    const m = model();
    m.controls.fast = { state: 'selectable', defaultValue: false, entitlement: 'unknown' };
    m.executionBindings = [{ id: 'fast', when: { fast: true }, entitlement: 'unknown', actions: kind === 'priority'
      ? [{ kind: 'request-patch', patch: { service_tier: 'priority' } }]
      : [{ kind: 'model-switch', targetModelId: 'fast-target' }] }];
    const f = dependencies(m);
    const response = await f.execute();
    f.execute.mockResolvedValue({ ...response, execution: kind === 'priority' ? { serviceTier: 'priority' } : { modelId: 'fast-target' } });
    f.execute.mockClear();
    await expect(new ProviderCapabilityProbeService(f.value).test({ providerId: 'provider-a', modelId: 'model-a', mode: 'fast' }))
      .resolves.toMatchObject({ success: true, status: 'verified' });
    expect(f.execute).toHaveBeenCalledOnce();
  });

  it.each(['length', 'refusal', 'toolUse'] as const)('never grants a capability on %s termination', async stopReason => {
    const f = dependencies(model());
    const response = await f.execute();
    f.execute.mockResolvedValue({ ...response, stopReason });
    await expect(new ProviderCapabilityProbeService(f.value).test({ providerId: 'provider-a', modelId: 'model-a', mode: 'default' }))
      .resolves.toMatchObject({ success: false, status: 'inconclusive' });
    expect(f.recordSuccess).not.toHaveBeenCalled();
  });

  it('discards late success and releases the lease after cancellation settles', async () => {
    const f = dependencies(model());
    const response = await f.execute();
    let finish!: (value: AssistantMessage) => void;
    f.execute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const pending = new ProviderCapabilityProbeService(f.value).test({ providerId: 'provider-a', modelId: 'model-a', mode: 'default' }, controller.signal);
    await Promise.resolve();
    controller.abort();
    expect(f.releaseCredentials).not.toHaveBeenCalled();
    finish(response);
    await expect(pending).resolves.toMatchObject({ status: 'cancelled', success: false });
    expect(f.releaseCredentials).toHaveBeenCalledOnce();
    expect(f.recordSuccess).not.toHaveBeenCalled();
  });

  it('discards success belonging to a changed account', async () => {
    const f = dependencies(model());
    const response = await f.execute();
    f.execute.mockImplementation(async () => {
      f.resolved.provider = { ...f.resolved.provider, activeAccountId: 'new-account' };
      return response;
    });
    await expect(new ProviderCapabilityProbeService(f.value).test({ providerId: 'provider-a', modelId: 'model-a', mode: 'default' }))
      .resolves.toMatchObject({ status: 'inconclusive', detail: expect.stringContaining('configuration changed') });
    expect(f.recordSuccess).not.toHaveBeenCalled();
  });
});


it('classifies explicit insufficient balance as quota without inventing subscription denial', () => {
  expect(classifyCapabilityProbeFailure(402, false, 'Insufficient Balance (insufficient_balance_error)')).toBe('quota-exhausted');
  expect(classifyCapabilityProbeFailure(402, false, 'payment required')).toBe('unknown');
});

it('records an explicit model subscription denial without downgrading structural capabilities', () => {
  const t = target(model());
  const request = { providerId: 'provider-a', modelId: 'model-a', mode: 'default' } as const;
  expect(buildProbeFailurePatch(request, t, plan(request, t.model).plan, 403, true)).toMatchObject({
    availability: 'unavailable', factSource: { sourceRevision: 'capability-probe:availability-denied' },
  });
  expect(buildProbeFailurePatch(request, t, plan(request, t.model).plan, 403, false)).toBeNull();
});


it('allows an explicit retry of an account-scoped probe denial while keeping ordinary unavailable models closed', async () => {
  const denied = model({ availability: 'unavailable', provenance: [{ field: 'availability', source: 'observed',
    observedAt: '2026-11-05', sourceRevision: 'capability-probe:availability-denied' }] });
  const f = dependencies(denied);
  const request = { providerId: 'provider-a', modelId: 'model-a', mode: 'default' } as const;
  await expect(new ProviderCapabilityProbeService(f.value).test(request)).resolves.toMatchObject({ success: true });
  expect(buildProbeSuccessPatch(request, f.resolved, plan(request, denied).plan)).toMatchObject({ availability: 'available' });
  const ordinary = dependencies(model({ availability: 'unavailable' }));
  await expect(new ProviderCapabilityProbeService(ordinary.value).test(request)).resolves.toMatchObject({ requestSent: false });
  expect(ordinary.execute).not.toHaveBeenCalled();
});
