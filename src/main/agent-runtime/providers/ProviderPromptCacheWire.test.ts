import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompiledPromptCache } from '@shared/types/semanticContext';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { Context, Model, StreamOptions } from '../core/types';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import { AnthropicProvider } from './AnthropicProvider';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { OpenAIResponsesProvider, __testing as responsesTesting } from './OpenAIResponsesProvider';

const model: Model = {
  id: 'gpt-5.6-sol',
  name: 'GPT-5.6 Sol',
  provider: 'provider',
  api: 'openai-responses',
  contextWindow: 1_000_000,
  maxTokens: 128_000,
  reasoning: true,
  vision: true,
};

const plan = (
  protocol: RequestPlan['route']['protocol'],
  adapterId: RequestPlan['adapterId'],
): RequestPlan => createTestRequestPlan({
  providerId: 'provider',
  adapterId,
  catalogRevision: 'catalog',
  routeRevision: 'route',
  selectedModelId: model.id,
  effectiveModelId: model.id,
  appliedBindingIds: [],
  route: { protocol, baseUrl: 'https://example.test/v1', source: 'catalog' },
  headers: {},
  bodyPatch: {},
  contextBudgetTokens: 900_000,
  contextMode: 'normal',
  contextWindowTokens: 1_000_000,
  activeTierId: 'default',
  fastMode: false,
  reasoningWire: {
    selection: 'off',
    control: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
  },
});

const context: Context = {
  systemPrompt: 'Stable instructions\n\nCurrent date: 2026-07-19',
  systemPromptSegments: [
    {
      id: 'stable',
      kind: 'core-contract',
      scope: 'builtin',
      sourcePath: 'builtin://stable',
      sourceHash: 'stable-hash',
      precedence: 0,
      content: 'Stable instructions',
      stability: 'stable',
      tokenEstimate: 4,
    },
    {
      id: 'volatile',
      kind: 'runtime-fact',
      scope: 'runtime',
      sourcePath: 'runtime://facts',
      sourceHash: 'volatile-hash',
      precedence: 1,
      content: 'Current date: 2026-07-19',
      stability: 'volatile',
      tokenEstimate: 6,
    },
  ],
  messages: [{ role: 'user', content: 'Hello', timestamp: 1 }],
  tools: [],
};

const openAiCache: CompiledPromptCache = {
  enabled: true,
  mode: 'automatic-and-explicit-breakpoints',
  keyCarrier: 'prompt-cache-key',
  breakpointCarrier: 'openai-prompt-cache',
  ttl: 'thirty-minutes',
  prefixFingerprint: 'prefix',
  requestKey: 'rdc:stable',
  breakpoint: 'automatic-and-explicit',
  stableSegmentIds: ['stable'],
  stableTokenEstimate: 4,
  providerReported: true,
  reason: 'test',
};

const anthropicCache: CompiledPromptCache = {
  ...openAiCache,
  mode: 'automatic-and-explicit-breakpoints',
  keyCarrier: 'none',
  breakpointCarrier: 'anthropic-cache-control',
  ttl: 'one-hour',
  requestKey: undefined,
};

afterEach(() => vi.unstubAllGlobals());

describe('provider prompt cache wire', () => {
  it('emits an OpenAI Responses developer block, explicit marker, request key, TTL, and write telemetry', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response([
        'data: {"type":"response.output_text.delta","delta":"OK"}',
        '',
        'data: {"type":"response.output_text.done"}',
        '',
        'data: {"type":"response.completed","response":{"id":"resp-1","status":"completed","usage":{"input_tokens":20,"output_tokens":2,"total_tokens":22,"input_tokens_details":{"cached_tokens":8,"cache_write_tokens":6}}}}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });

    const requestPlan = plan('OpenAIResponses', 'openai-responses');
    const provider = new OpenAIResponsesProvider({ apiKey: 'secret', baseUrl: 'https://example.test/v1' });
    const stream = provider.stream(model, context, { requestPlan, promptCache: openAiCache });
    for await (const _event of stream) {
      // drain stream for side effects on capturedBody
    }
    const message = await stream.result();

    expect(capturedBody).toMatchObject({
      prompt_cache_key: 'rdc:stable',
      prompt_cache_options: { mode: 'implicit', ttl: '30m' },
    });
    expect(capturedBody).not.toHaveProperty('instructions');
    const input = capturedBody?.input as Array<Record<string, unknown>>;
    expect(input[0]).toMatchObject({ type: 'message', role: 'developer' });
    expect((input[0].content as Array<Record<string, unknown>>)[0]).toMatchObject({
      type: 'input_text',
      text: 'Stable instructions\n\n',
      prompt_cache_breakpoint: { mode: 'explicit' },
    });
    expect(message.usage).toMatchObject({
      cacheReadTokens: 8,
      cacheWriteTokens: 6,
      cacheHitTokens: 8,
      cacheMissTokens: 12,
    });
  });

  it('emits Chat Completions prompt_cache_options and a marked stable system block', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response([
        'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":null}]}',
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":2,"total_tokens":22,"prompt_tokens_details":{"cached_tokens":9,"cache_write_tokens":7}}}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });

    const requestPlan = plan('OpenAICompatibleChatCompletions', 'openai-compatible');
    const provider = new OpenAICompatibleProvider({ apiKey: 'secret', baseUrl: 'https://example.test/v1' });
    const stream = provider.stream({ ...model, api: 'openai-compatible' }, context, {
      requestPlan,
      promptCache: openAiCache,
    });
    for await (const _event of stream) {
      // drain stream for side effects on capturedBody
    }
    const message = await stream.result();

    expect(capturedBody).toMatchObject({
      prompt_cache_key: 'rdc:stable',
      prompt_cache_options: { mode: 'implicit', ttl: '30m' },
    });
    const messages = capturedBody?.messages as Array<Record<string, unknown>>;
    expect((messages[0].content as Array<Record<string, unknown>>)[0]).toMatchObject({
      type: 'text',
      text: 'Stable instructions\n\n',
      prompt_cache_breakpoint: { mode: 'explicit' },
    });
    expect(message.usage).toMatchObject({
      cacheReadTokens: 9,
      cacheWriteTokens: 7,
      cacheHitTokens: 9,
      cacheMissTokens: 11,
    });
  });

  it('keeps Anthropic automatic caching and the stable system breakpoint orthogonal', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response([
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg-1","usage":{"input_tokens":20,"output_tokens":0,"cache_read_input_tokens":10,"cache_creation_input_tokens":5,"speed":"fast"}}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
        'event: message_delta',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2,"cache_read_input_tokens":10,"cache_creation_input_tokens":5,"speed":"fast"}}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
      ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });

    const requestPlan = plan('AnthropicMessages', 'anthropic-messages');
    const provider = new AnthropicProvider({ apiKey: 'secret', baseUrl: 'https://example.test/v1' });
    const stream = provider.stream({ ...model, api: 'anthropic-messages' }, context, {
      requestPlan,
      promptCache: anthropicCache,
    } as StreamOptions);
    for await (const _event of stream) {
      // drain stream for side effects on capturedBody
    }
    const message = await stream.result();

    expect(capturedBody?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    const system = capturedBody?.system as Array<Record<string, unknown>>;
    expect(system[0]).toMatchObject({
      type: 'text',
      text: 'Stable instructions\n\n',
      cache_control: { type: 'ephemeral', ttl: '1h' },
    });
    expect(system[1]).toEqual({ type: 'text', text: 'Current date: 2026-07-19' });
    expect(message.usage).toMatchObject({
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      cacheHitTokens: 10,
      cacheMissTokens: 25,
      speed: 'fast',
    });
  });

  it('keeps ordinary Responses instructions unchanged when explicit caching is unavailable', () => {
    const requestPlan = plan('OpenAIResponses', 'openai-responses');
    const body = responsesTesting.buildRequestBody(model, context, { requestPlan });
    expect(body.instructions).toBe(context.systemPrompt);
    expect(body).not.toHaveProperty('prompt_cache_options');
  });
});
