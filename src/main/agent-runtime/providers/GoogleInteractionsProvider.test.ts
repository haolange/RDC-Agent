import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderContractBundle } from '@shared/provider-catalog/modelManifestSchema';
import { createFailClosedProviderContracts } from '@shared/provider-catalog/providerContracts';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { ReasoningControl } from '@shared/types/modelCapability';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import type { AssistantMessage, Context, Model } from '../core/types';
import { createContinuationArtifact } from '../reasoning/ContinuationArtifacts';
import { createProviderStateRef } from '../reasoning/ProviderStateRefs';
import { GoogleInteractionsProvider } from './GoogleInteractionsProvider';
import {
  buildGoogleInteractionsRequest,
  toGoogleInteractionSteps,
} from './GoogleInteractionsWire';

const reasoningControl: ReasoningControl = {
  kind: 'levels' as const,
  supportsOff: false,
  levels: ['low', 'medium', 'high'],
  defaultSelection: 'high' as const,
  wireProfile: {
    kind: 'gemini-thinking-level' as const,
    on: 'high' as const,
    levels: { low: 'low' as const, medium: 'medium' as const, high: 'high' as const },
  },
};

function plan(
  modelId = 'gemini-3.5-flash',
  stateMode: 'local-stateless' | 'provider-managed' = 'provider-managed',
): RequestPlan {
  const fallback = createFailClosedProviderContracts('GoogleInteractions');
  const contracts: ProviderContractBundle = {
    ...fallback,
    protocolDialect: 'GoogleInteractions',
    protocolVersion: 'v1',
    compatibilityGroup: 'google-ai-studio:GoogleInteractions',
    reasoning: {
      semantic: 'summary',
      source: 'google-interactions-thought-steps',
      displayLabel: 'Reasoning summary',
      carrier: 'thought-signature',
      artifactFormat: 'google.interactions.thought-step',
      artifactVersion: 'steps-v1',
      compatibilityGroup: 'google-ai-studio:GoogleInteractions',
      continuation: 'same-compatibility-group',
      projectionSources: {
        summary: 'gemini-interactions-summary',
        opaque: 'gemini-interactions-thought-signature',
      },
    },
    state: {
      supportedModes: ['local-stateless', 'provider-managed'],
      defaultMode: 'provider-managed',
      carrier: 'previous-interaction-id',
      retention: 'provider',
      crossModel: 'provider-managed',
    },
    cache: {
      mode: 'implicit-prefix',
      keyCarrier: 'provider-managed',
      breakpointCarrier: 'provider-managed',
      telemetry: ['cached-input-tokens'],
      ttl: 'provider-managed',
    },
    toolLoop: {
      artifactPolicy: 'preserve-exact',
      artifactScope: 'all-assistant-turns',
      ordering: 'provider-native',
      modelSwitch: 'pin-until-terminal',
    },
    streaming: {
      transport: 'sse',
      outputIdentity: 'provider-output-ref',
      usage: 'terminal',
      errors: 'provider-event',
    },
  };
  return createTestRequestPlan({
    providerId: 'google-ai-studio',
    adapterId: 'google-interactions',
    catalogRevision: 'google-catalog',
    routeRevision: 'google-interactions-v1',
    selectedModelId: modelId,
    effectiveModelId: modelId,
    appliedBindingIds: [],
    route: {
      protocol: 'GoogleInteractions',
      baseUrl: 'https://generativelanguage.googleapis.com/v1',
      source: 'catalog',
      contracts,
    },
    contracts,
    statePlan: {
      mode: stateMode,
      carrier: stateMode === 'provider-managed' ? 'previous-interaction-id' : 'none',
      store: stateMode === 'provider-managed',
      reuseProviderState: stateMode === 'provider-managed',
    },
    headers: {},
    bodyPatch: {},
    contextBudgetTokens: 256_000,
    contextMode: 'normal',
    contextWindowTokens: 1_048_576,
    activeTierId: 'default',
    fastMode: false,
    reasoningWire: { selection: 'high', control: reasoningControl },
  });
}

const model: Model = {
  id: 'gemini-3.5-flash',
  name: 'Gemini 3.5 Flash',
  provider: 'google-ai-studio',
  api: 'google-interactions',
  contextWindow: 1_048_576,
  maxTokens: 8192,
  reasoning: true,
  vision: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GoogleInteractionsProvider', () => {
  it('consumes the GA steps stream and preserves thought, tool, state, and usage artifacts', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      request = { url: String(url), init };
      return new Response([
        'event: interaction.created',
        'data: {"event_type":"interaction.created","interaction":{"id":"int_1","status":"in_progress"}}',
        '',
        'event: step.start',
        'data: {"event_type":"step.start","index":0,"step":{"type":"thought","signature":"","summary":[]}}',
        '',
        'event: step.delta',
        'data: {"event_type":"step.delta","index":0,"delta":{"type":"thought_summary","content":{"type":"text","text":"Check weather."}}}',
        '',
        'event: step.delta',
        'data: {"event_type":"step.delta","index":0,"delta":{"type":"thought_signature","signature":"sig_1"}}',
        '',
        'event: step.stop',
        'data: {"event_type":"step.stop","index":0}',
        '',
        'event: step.start',
        'data: {"event_type":"step.start","index":1,"step":{"type":"function_call","id":"call_1","name":"weather"}}',
        '',
        'event: step.delta',
        'data: {"event_type":"step.delta","index":1,"delta":{"type":"arguments_delta","arguments":"{\\\"city\\\":\\\""}}',
        '',
        'event: step.delta',
        'data: {"event_type":"step.delta","index":1,"delta":{"type":"arguments_delta","arguments":"Paris\\\"}"}}',
        '',
        'event: step.stop',
        'data: {"event_type":"step.stop","index":1}',
        '',
        'event: interaction.requires_action',
        'data: {"event_type":"interaction.requires_action","interaction":{"id":"int_1","status":"requires_action","usage":{"total_input_tokens":11,"total_output_tokens":7,"total_thought_tokens":3,"total_cached_tokens":5,"total_tokens":21}}}',
        '',
        'event: done',
        'data: [DONE]',
        '',
      ].join('\n'), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    const context: Context = {
      systemPrompt: 'Stay precise.',
      messages: [{ role: 'user', content: 'Weather?', timestamp: 1 }],
      tools: [{
        name: 'weather',
        description: 'Read weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      }],
    };
    const message = await new GoogleInteractionsProvider({
      apiKey: 'secret',
      baseUrl: 'https://generativelanguage.googleapis.com/v1',
    }).stream(model, context, {
      requestPlan: plan(),
      reasoning: { selection: 'high', control: reasoningControl },
      reasoningVisibility: 'summary-events',
    }).result();

    expect(request?.url).toBe('https://generativelanguage.googleapis.com/v1/interactions');
    expect(new Headers(request?.init?.headers).get('x-goog-api-key')).toBe('secret');
    expect(JSON.parse(String(request?.init?.body))).toMatchObject({
      model: 'gemini-3.5-flash',
      store: true,
      system_instruction: 'Stay precise.',
      generation_config: { thinking_level: 'high', thinking_summaries: 'auto' },
      tools: [{ type: 'function', name: 'weather' }],
    });
    expect(message.stopReason).toBe('toolUse');
    expect(message.usage).toMatchObject({
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 21,
      reasoningTokens: 3,
      cacheReadTokens: 5,
    });
    expect(message.providerState).toMatchObject({
      carrier: 'previous-interaction-id',
      value: 'int_1',
    });
    expect(message.content).toEqual([
      expect.objectContaining({
        type: 'thinking',
        text: 'Check weather.',
        kind: 'summary',
        source: 'gemini-interactions-summary',
        continuation: expect.objectContaining({
          signature: 'sig_1',
          raw: {
            type: 'thought',
            signature: 'sig_1',
            summary: [{ type: 'text', text: 'Check weather.' }],
          },
        }),
      }),
      expect.objectContaining({
        type: 'toolCall',
        id: 'call_1',
        name: 'weather',
        arguments: { city: 'Paris' },
      }),
    ]);
  });

  it('fails closed when a thought step stops before its required signature', async () => {
    vi.stubGlobal('fetch', async () => new Response([
      'data: {"event_type":"interaction.created","interaction":{"id":"int_1"}}',
      '',
      'data: {"event_type":"step.start","index":0,"step":{"type":"thought","summary":[]}}',
      '',
      'data: {"event_type":"step.stop","index":0}',
      '',
    ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    await expect(new GoogleInteractionsProvider({ apiKey: 'secret' })
      .stream(model, { messages: [{ role: 'user', content: 'x', timestamp: 1 }] }, {
        requestPlan: plan(),
      }).result()).rejects.toThrow('thought step ended without its required signature');
  });
});

describe('Google Interactions context compilation', () => {
  it('sends only post-anchor input while re-sending interaction-scoped settings', () => {
    const requestPlan = plan();
    const providerState = createProviderStateRef(requestPlan, 'int_anchor');
    const priorAssistant: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'old answer' }],
      model: model.id,
      provider: model.provider,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      stopReason: 'stop',
      providerState,
      timestamp: 2,
    };
    const body = buildGoogleInteractionsRequest(model, {
      systemPrompt: 'System remains request-scoped.',
      messages: [
        { role: 'user', content: 'old', timestamp: 1 },
        priorAssistant,
        { role: 'user', content: 'new', timestamp: 3 },
      ],
      tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object' } }],
    }, {
      requestPlan,
      reasoning: { selection: 'high', control: reasoningControl },
      reasoningVisibility: 'summary-events',
    });

    expect(body).toMatchObject({
      previous_interaction_id: 'int_anchor',
      store: true,
      system_instruction: 'System remains request-scoped.',
      tools: [{ name: 'lookup' }],
      generation_config: { thinking_level: 'high', thinking_summaries: 'auto' },
      input: [{ type: 'user_input', content: [{ type: 'text', text: 'new' }] }],
    });
  });

  it('replays exact thought steps across models only inside the declared Google compatibility group', () => {
    const sourcePlan = plan('gemini-3.5-flash', 'local-stateless');
    const targetPlan = plan('gemini-3.1-pro-preview', 'local-stateless');
    const raw = {
      type: 'thought',
      signature: 'sig_cross_model',
      summary: [{ type: 'text', text: 'Preserve me.' }],
    };
    const continuation = createContinuationArtifact(sourcePlan, {
      type: 'thought',
      signature: 'sig_cross_model',
      raw,
    });
    const steps = toGoogleInteractionSteps([{
      role: 'assistant',
      content: [{
        type: 'thinking',
        text: 'Preserve me.',
        kind: 'summary',
        source: 'gemini-interactions-summary',
        visibility: 'summary',
        continuation,
      }],
      model: 'gemini-3.5-flash',
      provider: 'google-ai-studio',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      stopReason: 'stop',
      timestamp: 1,
    }], targetPlan);

    expect(steps).toEqual([raw]);
  });
});
