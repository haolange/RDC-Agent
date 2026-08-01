import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestPlan } from '@shared/types/providerCapability';
import { providerAdapterIdForProtocol } from '@shared/provider-catalog/implementationRegistry';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import type { Context, Model } from '../core/types';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider';

const model: Model = {
  id: 'openai.gpt-test',
  name: 'openai.gpt-test',
  provider: 'amazon-bedrock',
  api: 'openai-compatible',
  contextWindow: 128_000,
  maxTokens: 1_024,
  reasoning: false,
  vision: false,
};
const context: Context = {
  messages: [{ role: 'user', content: 'ping', timestamp: 1 }],
};

function plan(protocol: RequestPlan['route']['protocol'], baseUrl: string): RequestPlan {
  return createTestRequestPlan({
    providerId: 'amazon-bedrock',
    adapterId: providerAdapterIdForProtocol(protocol),
    catalogRevision: 'catalog',
    routeRevision: 'route',
    selectedModelId: model.id,
    effectiveModelId: model.id,
    appliedBindingIds: [],
    route: { protocol, baseUrl, source: 'catalog' },
    headers: {},
    bodyPatch: {},
    contextBudgetTokens: 128_000,
    contextMode: 'normal',
    contextWindowTokens: 128_000,
    activeTierId: 'default',
    fastMode: false,
    reasoningWire: {
      selection: 'off',
      control: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Bedrock body-aware request authorization', () => {
  it('signs the exact Chat Completions URL and JSON bytes before fetch', async () => {
    const requestAuthorizer = vi.fn(async (input: {
      url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body: string;
    }) => ({ ...input.headers, Authorization: 'AWS4-HMAC-SHA256 signed-chat' }));
    let fetched: { url: string; init?: RequestInit } | undefined;
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      fetched = { url: String(url), init };
      return new Response(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    });
    const baseUrl = 'https://bedrock-mantle.us-east-1.api.aws/v1';
    const provider = new OpenAICompatibleProvider({ baseUrl, authorization: 'none', requestAuthorizer });
    await provider.stream(model, context, { requestPlan: plan('OpenAICompatibleChatCompletions', baseUrl) }).result();

    expect(requestAuthorizer).toHaveBeenCalledTimes(1);
    expect(requestAuthorizer.mock.calls[0]?.[0]).toMatchObject({
      url: `${baseUrl}/chat/completions`,
      method: 'POST',
    });
    expect(fetched?.url).toBe(`${baseUrl}/chat/completions`);
    expect(fetched?.init?.body).toBe(requestAuthorizer.mock.calls[0]?.[0].body);
    expect(new Headers(fetched?.init?.headers).get('Authorization')).toBe('AWS4-HMAC-SHA256 signed-chat');
  });

  it('signs the exact Responses URL and JSON bytes before fetch', async () => {
    const requestAuthorizer = vi.fn(async (input: {
      url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body: string;
    }) => ({ ...input.headers, Authorization: 'AWS4-HMAC-SHA256 signed-responses' }));
    let fetched: { url: string; init?: RequestInit } | undefined;
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      fetched = { url: String(url), init };
      return new Response([
        'data: {"type":"response.output_text.delta","delta":"ok"}',
        'data: {"type":"response.completed","response":{"status":"completed"}}',
        'data: [DONE]',
        '',
      ].join('\n\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const baseUrl = 'https://bedrock-mantle.us-east-1.api.aws/openai/v1';
    const provider = new OpenAIResponsesProvider({ baseUrl, requestAuthorizer });
    await provider.stream(
      { ...model, api: 'openai-responses' },
      context,
      { requestPlan: plan('OpenAIResponses', baseUrl) },
    ).result();

    expect(requestAuthorizer).toHaveBeenCalledTimes(1);
    expect(requestAuthorizer.mock.calls[0]?.[0]).toMatchObject({
      url: `${baseUrl}/responses`,
      method: 'POST',
    });
    expect(fetched?.url).toBe(`${baseUrl}/responses`);
    expect(fetched?.init?.body).toBe(requestAuthorizer.mock.calls[0]?.[0].body);
    expect(new Headers(fetched?.init?.headers).get('Authorization')).toBe('AWS4-HMAC-SHA256 signed-responses');
  });
  it('fails closed when Chat Completions emits a semantic choice after finish_reason', async () => {
    vi.stubGlobal('fetch', async () => new Response([
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
      'data: {"choices":[{"delta":{"content":"late"},"finish_reason":null}]}',
      'data: [DONE]',
      '',
    ].join('\n\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    const baseUrl = 'https://bedrock-mantle.us-east-1.api.aws/v1';
    const provider = new OpenAICompatibleProvider({ baseUrl, authorization: 'none', requestAuthorizer: async (input) => input.headers });

    await expect(provider.stream(model, context, {
      requestPlan: plan('OpenAICompatibleChatCompletions', baseUrl),
    }).result()).rejects.toMatchObject({ code: 'PROVIDER_STREAM_EVENT_AFTER_TERMINAL' });
  });

  it('accepts a non-semantic usage trailer after Chat Completions finish_reason', async () => {
    vi.stubGlobal('fetch', async () => new Response([
      'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":null}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}',
      'data: [DONE]',
      '',
    ].join('\n\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    const baseUrl = 'https://bedrock-mantle.us-east-1.api.aws/v1';
    const provider = new OpenAICompatibleProvider({ baseUrl, authorization: 'none', requestAuthorizer: async (input) => input.headers });

    await expect(provider.stream(model, context, {
      requestPlan: plan('OpenAICompatibleChatCompletions', baseUrl),
    }).result()).resolves.toMatchObject({
      content: expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'ok' })]),
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    });
  });

  it('fails closed when Responses emits an event after response.completed', async () => {
    vi.stubGlobal('fetch', async () => new Response([
      'data: {"type":"response.output_text.delta","delta":"ok"}',
      'data: {"type":"response.completed","response":{"status":"completed"}}',
      'data: {"type":"response.output_text.delta","delta":"late"}',
      'data: [DONE]',
      '',
    ].join('\n\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    const baseUrl = 'https://bedrock-mantle.us-east-1.api.aws/openai/v1';
    const provider = new OpenAIResponsesProvider({ baseUrl, requestAuthorizer: async (input) => input.headers });

    await expect(provider.stream(
      { ...model, api: 'openai-responses' },
      context,
      { requestPlan: plan('OpenAIResponses', baseUrl) },
    ).result()).rejects.toMatchObject({ code: 'PROVIDER_STREAM_EVENT_AFTER_TERMINAL' });
  });
});
