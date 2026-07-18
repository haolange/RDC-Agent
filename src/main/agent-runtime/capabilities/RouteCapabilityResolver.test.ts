import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import type { LlmProviderEntry } from '@shared/types/settings';
import {
  claimStructuredToolCallingEvidence,
  describeRouteCapabilityDiagnostic,
  resolveAgentRouteCapability,
} from './RouteCapabilityResolver';

const provider = {
  id: 'test-provider',
  enabled: true,
  isConfigured: true,
  status: 'verified',
  protocol: 'OpenAICompatibleChatCompletions',
  capabilities: ['chat', 'tool-calling', 'vision-input', 'structured-output'],
} as LlmProviderEntry;

function model(patch: Partial<EffectiveModel> = {}): EffectiveModel {
  return {
    providerId: provider.id,
    modelId: 'model-a',
    label: 'Model A',
    aliases: [],
    enabled: true,
    route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://example.test', source: 'catalog' },
    availability: 'available',
    presencePolicy: 'maintained',
    contextTiers: [{ id: 'default', label: 'Default', activation: { kind: 'implicit' }, entitlement: 'granted' }],
    defaultBudgetTokens: 256_000,
    controls: {
      fast: { state: 'unsupported', fixedValue: false },
      context1m: { state: 'unsupported', fixedValue: false },
      reasoning: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
    },
    toolCalling: { state: 'unknown' },
    visionInput: { state: 'unknown' },
    structuredOutput: { state: 'unknown' },
    provenance: [],
    ...patch,
  };
}

describe('resolveAgentRouteCapability effective-state policy', () => {
  it('resolves reasoning only from the active route contract and honors the frozen RequestPlan route', () => {
    const rawModel = model({
      controls: {
        fast: { state: 'unsupported', fixedValue: false },
        context1m: { state: 'unsupported', fixedValue: false },
        reasoning: {
          kind: 'toggle',
          supportsOff: true,
          levels: [],
          defaultSelection: 'on',
          wireProfile: { kind: 'none' },
        },
      },
      route: {
        protocol: 'OpenAICompatibleChatCompletions',
        baseUrl: 'https://example.test',
        source: 'catalog',
        reasoningContract: {
          semantic: 'raw',
          source: 'manifest:test-raw',
          displayLabel: 'Raw reasoning',
        },
      },
    });
    expect(resolveAgentRouteCapability(provider, 'model-a', rawModel).reasoningContract.semantic).toBe('raw');

    const frozenPlan = {
      route: {
        protocol: 'OpenAIResponses',
        baseUrl: 'https://example.test/v1',
        source: 'catalog',
        reasoningContract: {
          semantic: 'summary',
          source: 'manifest:test-summary',
          displayLabel: 'Reasoning summary',
        },
      },
    } as unknown as import('@shared/types/providerCapability').RequestPlan;
    expect(resolveAgentRouteCapability(provider, 'model-a', rawModel, frozenPlan).reasoningContract.semantic)
      .toBe('summary');

    const undeclared = model({
      controls: rawModel.controls,
      route: {
        protocol: 'OpenAICompatibleChatCompletions',
        baseUrl: 'https://third-party.test',
        source: 'user',
      },
    });
    expect(resolveAgentRouteCapability(provider, 'model-a', undeclared).reasoningContract.semantic)
      .toBe('unknown');
  });

  it('fails open for unknown tools but marks the route unverified', () => {
    const capability = resolveAgentRouteCapability(provider, 'model-a', model());
    expect(capability).toMatchObject({
      toolCallingMode: 'native-structured',
      toolCallingUnverified: true,
    });
    expect(describeRouteCapabilityDiagnostic(capability, 3)).toEqual({
      code: 'route_tool_calling_unverified',
      severity: 'info',
      message: expect.stringContaining('Tools remain enabled'),
      surface: 'runtime-log',
    });
  });

  it('fails closed for unknown vision and uses prompt fallback for unknown structured output', () => {
    expect(resolveAgentRouteCapability(provider, 'model-a', model())).toMatchObject({
      visionInputMode: 'disabled',
      structuredOutputMode: 'prompt-fallback',
    });
  });

  it('honors explicit supported and unsupported states', () => {
    expect(resolveAgentRouteCapability(provider, 'model-a', model({
      toolCalling: { state: 'unsupported' },
      visionInput: { state: 'supported' },
      structuredOutput: { state: 'supported' },
    }))).toMatchObject({
      toolCallingMode: 'text-only',
      toolCallingUnverified: false,
      visionInputMode: 'native',
      structuredOutputMode: 'native',
    });
  });

  it('uses EffectiveModel instead of the provider static capability list', () => {
    expect(resolveAgentRouteCapability(
      { ...provider, capabilities: ['chat'] },
      'model-a',
      model({ toolCalling: { state: 'supported' } }),
    )).toMatchObject({
      toolCallingMode: 'native-structured',
      toolCallingUnverified: false,
    });
  });

  it('fails closed for an unavailable EffectiveModel', () => {
    const capability = resolveAgentRouteCapability(provider, 'model-a', model({
      availability: 'unavailable',
      unavailableReason: 'adapter unavailable',
    }));
    expect(capability).toMatchObject({
      toolCallingMode: 'disabled',
      supportsStreaming: false,
      visionInputMode: 'disabled',
      structuredOutputMode: 'prompt-fallback',
    });
    expect(describeRouteCapabilityDiagnostic(capability, 3)).toMatchObject({
      code: 'route_tool_calling_disabled',
      severity: 'error',
      surface: 'work-process',
    });
  });

  it('reports explicit tool-call rejection as a warning without registering tools', () => {
    const capability = resolveAgentRouteCapability(provider, 'model-a', model({
      toolCalling: { state: 'unsupported' },
    }));
    expect(describeRouteCapabilityDiagnostic(capability, 3)).toMatchObject({
      code: 'route_tool_calling_unsupported',
      severity: 'warning',
      surface: 'work-process',
    });
  });

  it('claims observed evidence only once for a structured adapter tool-call end event', () => {
    const capability = resolveAgentRouteCapability(provider, 'model-a', model());
    const gate = { recorded: false };
    expect(claimStructuredToolCallingEvidence('text_delta', capability, gate)).toBe(false);
    expect(claimStructuredToolCallingEvidence('toolcall_end', capability, gate)).toBe(true);
    expect(claimStructuredToolCallingEvidence('toolcall_end', capability, gate)).toBe(false);
    expect(gate.recorded).toBe(true);
  });

  it('does not treat text-only tool-shaped output as capability evidence', () => {
    const capability = resolveAgentRouteCapability(provider, 'model-a', model());
    expect(claimStructuredToolCallingEvidence('message_end', capability, { recorded: false })).toBe(false);
  });

  it.each([
    ['unknown', 'native-structured', true, 'disabled', 'prompt-fallback'],
    ['supported', 'native-structured', false, 'native', 'native'],
    ['unsupported', 'text-only', false, 'disabled', 'prompt-fallback'],
  ] as const)('applies the shared unknown policy table for %s', (state, tools, unverified, vision, structured) => {
    expect(resolveAgentRouteCapability(provider, 'model-a', model({
      toolCalling: { state }, visionInput: { state }, structuredOutput: { state },
    }))).toMatchObject({
      toolCallingMode: tools,
      toolCallingUnverified: unverified,
      visionInputMode: vision,
      structuredOutputMode: structured,
    });
  });
});
