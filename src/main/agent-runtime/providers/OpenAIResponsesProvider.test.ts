import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderContractBundle } from '@shared/provider-catalog/modelManifestSchema';
import { createFailClosedProviderContracts } from '@shared/provider-catalog/providerContracts';
import type { ReasoningControl } from '@shared/types/modelCapability';
import type { RequestPlan } from '@shared/types/providerCapability';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import type { Context, Model } from '../core/types';
import { OpenAIResponsesProvider, __testing } from './OpenAIResponsesProvider';
import { ProviderEmptyStreamError, ProviderHttpError, ProviderWireFailureError } from './internal/http';

const reasoningControl = {
  kind: 'levels',
  supportsOff: true,
  levels: ['low', 'high', 'xhigh', 'max'],
  defaultSelection: 'high',
  wireProfile: {
    kind: 'openai-responses',
    on: 'high',
    levels: { low: 'low', high: 'high', xhigh: 'high', max: 'max' },
    offMode: 'reasoning-none',
  },
} satisfies ReasoningControl;

function deepSeekPlan(): RequestPlan {
  const fallback = createFailClosedProviderContracts('OpenAIResponses');
  const contracts: ProviderContractBundle = {
    ...fallback,
    protocolDialect: 'DeepSeekResponses',
    protocolVersion: '2026-07-31',
    compatibilityGroup: 'deepseek:OpenAIResponses',
    reasoning: {
      semantic: 'raw',
      source: 'deepseek-responses-reasoning-text',
      displayLabel: 'Raw reasoning',
      carrier: 'reasoning-item',
      artifactFormat: 'deepseek.responses.reasoning',
      artifactVersion: 'v1',
      compatibilityGroup: 'deepseek:OpenAIResponses',
      continuation: 'exact-execution',
      projectionSources: { raw: 'deepseek-raw' },
    },
    state: {
      supportedModes: ['local-stateless'],
      defaultMode: 'local-stateless',
      carrier: 'none',
      retention: 'request',
      crossModel: 'never',
    },
    cache: {
      mode: 'implicit-prefix',
      keyCarrier: 'none',
      breakpointCarrier: 'none',
      telemetry: ['cached-input-tokens'],
      ttl: 'provider-managed',
    },
    toolLoop: {
      artifactPolicy: 'preserve-exact',
      artifactScope: 'tool-call-turn',
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
    providerId: 'deepseek',
    adapterId: 'openai-responses',
    catalogRevision: 'deepseek-catalog',
    routeRevision: 'deepseek-responses-2026-07-31',
    selectedModelId: 'deepseek-v4-flash',
    effectiveModelId: 'deepseek-v4-flash',
    appliedBindingIds: ['reasoning:strip-inert-sampling'],
    route: {
      protocol: 'OpenAIResponses',
      baseUrl: 'https://api.deepseek.com',
      source: 'catalog',
      contracts,
    },
    contracts,
    statePlan: {
      mode: 'local-stateless',
      carrier: 'none',
      store: false,
      reuseProviderState: false,
    },
    headers: {},
    bodyPatch: {
      temperature: null,
      top_p: null,
      presence_penalty: null,
      frequency_penalty: null,
    },
    contextBudgetTokens: 1_000_000,
    contextMode: 'one-million',
    contextWindowTokens: 1_000_000,
    activeTierId: 'default',
    fastMode: false,
    reasoningWire: { selection: 'high', control: reasoningControl },
  });
}

const model: Model = {
  id: 'deepseek-v4-flash',
  name: 'DeepSeek V4 Flash',
  provider: 'deepseek',
  api: 'openai-responses',
  contextWindow: 1_000_000,
  maxTokens: 384_000,
  reasoning: true,
  vision: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAIResponsesProvider DeepSeek dialect', () => {
  it('streams raw reasoning, preserves the exact item for tool continuation, and omits unsupported state fields', async () => {
    let request: RequestInit | undefined;
    const reasoningItem = { type: 'reasoning', id: 'rs_1', content: 'Need the tool.' };
    vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      request = init;
      return new Response([
        'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"reasoning","id":"rs_1","content":[]}}',
        '',
        'data: {"type":"response.reasoning_text.delta","item_id":"rs_1","output_index":0,"delta":"Need the "}',
        '',
        'data: {"type":"response.reasoning_text.delta","item_id":"rs_1","output_index":0,"delta":"tool."}',
        '',
        'data: {"type":"response.reasoning_text.done","item_id":"rs_1","output_index":0,"text":"Need the tool."}',
        '',
        `data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: reasoningItem })}`,
        '',
        'data: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"lookup"}}',
        '',
        'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":1,"delta":"{\\"id\\":1}"}',
        '',
        'data: {"type":"response.function_call_arguments.done","item_id":"fc_1","output_index":1,"arguments":"{\\"id\\":1}"}',
        '',
        'data: {"type":"response.output_item.done","output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"lookup","arguments":"{\\"id\\":1}"}}',
        '',
        `data: ${JSON.stringify({
          type: 'response.completed',
          response: {
            id: 'resp_1',
            status: 'completed',
            output: [reasoningItem, { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '{"id":1}' }],
            usage: {
              input_tokens: 20,
              output_tokens: 8,
              total_tokens: 28,
              input_tokens_details: { cached_tokens: 5 },
              output_tokens_details: { reasoning_tokens: 4 },
            },
          },
        })}`,
        '',
      ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });

    const context: Context = {
      systemPrompt: 'Use tools precisely.',
      messages: [{ role: 'user', content: 'Look it up.', timestamp: 1 }],
      tools: [{
        name: 'lookup',
        description: 'Lookup an id',
        parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
      }],
    };
    const requestPlan = deepSeekPlan();
    const message = await new OpenAIResponsesProvider({ apiKey: 'secret' }).stream(model, context, {
      requestPlan,
      reasoning: { selection: 'high', control: reasoningControl },
      temperature: 1,
      topP: 0.95,
    }).result();

    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'deepseek-v4-flash',
      stream: true,
      reasoning: { effort: 'high' },
      tools: [expect.objectContaining({ type: 'function', name: 'lookup' })],
    });
    for (const unsupported of [
      'store', 'parallel_tool_calls', 'previous_response_id', 'include',
      'prompt_cache_key', 'prompt_cache_options', 'temperature', 'top_p',
    ]) {
      expect(body).not.toHaveProperty(unsupported);
    }
    expect(message.stopReason).toBe('toolUse');
    expect(message.usage).toMatchObject({
      inputTokens: 20,
      outputTokens: 8,
      totalTokens: 28,
      reasoningTokens: 4,
      cacheReadTokens: 5,
    });
    expect(message.content).toEqual([
      expect.objectContaining({
        type: 'thinking',
        text: 'Need the tool.',
        kind: 'raw',
        source: 'deepseek-raw',
        continuation: expect.objectContaining({ raw: reasoningItem }),
      }),
      expect.objectContaining({
        type: 'toolCall',
        id: 'call_1',
        name: 'lookup',
        arguments: { id: 1 },
      }),
    ]);

    const replay = __testing.toResponsesInput({
      messages: [
        { role: 'user', content: 'Look it up.', timestamp: 1 },
        message,
        {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'lookup',
          content: [{ type: 'text', text: 'result' }],
          isError: false,
          timestamp: 2,
        },
      ],
    }, requestPlan);
    expect(replay).toEqual([
      expect.objectContaining({ role: 'user' }),
      reasoningItem,
      expect.objectContaining({ type: 'function_call', call_id: 'call_1' }),
      expect.objectContaining({ type: 'function_call_output', call_id: 'call_1', output: 'result' }),
    ]);
  });
});

describe('OpenAIResponsesProvider empty stream', () => {
  it('throws ProviderEmptyStreamError instead of a synthetic HTTP 502', async () => {
    vi.stubGlobal('fetch', async () => new Response([
      'data: {"type":"response.completed","response":{"id":"resp_empty","status":"completed","output":[]}}',
      '',
    ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    const context: Context = {
      systemPrompt: 'Answer.',
      messages: [{ role: 'user', content: 'Hello', timestamp: 1 }],
    };
    const error = await new OpenAIResponsesProvider({ apiKey: 'secret' }).stream(model, context, {
      requestPlan: deepSeekPlan(),
    }).result().then(
      () => {
        throw new Error('expected empty stream to reject');
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderEmptyStreamError);
    expect(error).toMatchObject({
      name: 'ProviderEmptyStreamError',
      code: 'PROVIDER_STREAM_EMPTY',
      message: 'Provider stream ended without assistant output or structured tool call.',
    });
    expect(error).not.toMatchObject({ status: 502 });
  });
});

describe('OpenAIResponsesProvider SSE stream failures', () => {
  it('throws ProviderWireFailureError for error events without HTTP status', async () => {
    vi.stubGlobal('fetch', async () => new Response([
      'data: {"type":"error","message":"Account suspended by provider"}',
      '',
    ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    const context: Context = {
      systemPrompt: 'Answer.',
      messages: [{ role: 'user', content: 'Hello', timestamp: 1 }],
    };
    const error = await new OpenAIResponsesProvider({ apiKey: 'secret' }).stream(model, context, {
      requestPlan: deepSeekPlan(),
    }).result().then(
      () => {
        throw new Error('expected stream error to reject');
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderWireFailureError);
    expect(error).not.toBeInstanceOf(ProviderHttpError);
    expect((error as ProviderWireFailureError).message).toContain('Account suspended by provider');
    expect((error as ProviderWireFailureError).message).not.toContain('HTTP 502');
  });

  it('throws ProviderHttpError 401 for response.failed with explicit status', async () => {
    vi.stubGlobal('fetch', async () => new Response([
      'data: {"type":"response.failed","response":{"error":{"message":"invalid api key","status":401}}}',
      '',
    ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    const context: Context = {
      systemPrompt: 'Answer.',
      messages: [{ role: 'user', content: 'Hello', timestamp: 1 }],
    };
    const error = await new OpenAIResponsesProvider({ apiKey: 'secret' }).stream(model, context, {
      requestPlan: deepSeekPlan(),
    }).result().then(
      () => {
        throw new Error('expected auth failure to reject');
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect((error as ProviderHttpError).status).toBe(401);
    expect((error as ProviderHttpError).message).toContain('invalid api key');
  });
});
