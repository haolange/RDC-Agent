import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../../agent-runtime/providers/AnthropicProvider';
import { GeminiProvider } from '../../agent-runtime/providers/GeminiProvider';
import { OllamaProvider } from '../../agent-runtime/providers/OllamaProvider';
import { OpenAICompatibleProvider } from '../../agent-runtime/providers/OpenAICompatibleProvider';
import { OpenAIResponsesProvider } from '../../agent-runtime/providers/OpenAIResponsesProvider';
import { createTestRequestPlan } from '../createTestRequestPlan';
import type { Context, Model, StreamOptions } from '../../agent-runtime/core/types';
import type { LlmProviderProtocol } from '@shared/types/settings';

/**
 * Every wire family ends a message only on its own terminal signal. Output followed by a closed connection is a
 * truncation and a frame that is not JSON is a protocol violation; neither may surface as a completed answer.
 */

const BASE_URL = 'https://provider.fixture';
const sse = (payload: unknown, event?: string) =>
  `${event ? `event: ${event}\n` : ''}data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`;
const jsonLine = (payload: unknown) => `${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n`;

interface WireFamily {
  name: string;
  protocol: LlmProviderProtocol;
  adapterId: string;
  api: string;
  contentType: string;
  create: () => { stream: (model: Model, context: Context, options: StreamOptions) => AsyncIterable<unknown> & { result(): Promise<unknown> } };
  complete: string[];
  truncated: string[];
  malformed: string[];
}

const chat = (delta: Record<string, unknown>, finishReason: string | null = null) =>
  sse({ choices: [{ index: 0, delta, finish_reason: finishReason }] });
const anthropicStart = sse({ type: 'message_start', message: { id: 'msg_1', model: 'm', usage: { input_tokens: 1, output_tokens: 0 } } }, 'message_start');
const anthropicText = [
  sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, 'content_block_start'),
  sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }, 'content_block_delta'),
];
const gemini = (text: string, finishReason?: string) =>
  sse({ candidates: [{ content: { role: 'model', parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] });
const responsesText = [
  sse({ type: 'response.output_item.added', output_index: 0, item: { id: 'msg_1', type: 'message' } }),
  sse({ type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', content_index: 0, delta: 'Hello' }),
];

const FAMILIES: WireFamily[] = [
  {
    name: 'chat completions',
    protocol: 'OpenAICompatibleChatCompletions',
    adapterId: 'openai-compatible',
    api: 'openai-compatible',
    contentType: 'text/event-stream',
    create: () => new OpenAICompatibleProvider({ apiKey: 'fixture', baseUrl: BASE_URL }),
    complete: [chat({ content: 'Hello' }), chat({}, 'stop'), 'data: [DONE]\n\n'],
    truncated: [chat({ content: 'Hello wor' })],
    malformed: [chat({ content: 'A' }), sse('{"choices":[{"delta":{"content":"B'), chat({ content: 'C' }), chat({}, 'stop')],
  },
  {
    name: 'anthropic messages',
    protocol: 'AnthropicMessages',
    adapterId: 'anthropic-messages',
    api: 'anthropic-messages',
    contentType: 'text/event-stream',
    create: () => new AnthropicProvider({ apiKey: 'fixture', baseUrl: BASE_URL }),
    complete: [
      anthropicStart,
      ...anthropicText,
      sse({ type: 'content_block_stop', index: 0 }, 'content_block_stop'),
      sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }, 'message_delta'),
      sse({ type: 'message_stop' }, 'message_stop'),
    ],
    truncated: [anthropicStart, ...anthropicText],
    malformed: [anthropicStart, ...anthropicText, sse('{garbled'), sse({ type: 'message_stop' }, 'message_stop')],
  },
  {
    name: 'ollama json lines',
    protocol: 'OllamaOpenAICompatibleChatCompletions',
    adapterId: 'ollama-openai-compatible',
    api: 'ollama',
    contentType: 'application/x-ndjson',
    create: () => new OllamaProvider({ baseUrl: BASE_URL }),
    complete: [
      jsonLine({ message: { role: 'assistant', content: 'Hello' }, done: false }),
      jsonLine({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }),
    ],
    truncated: [jsonLine({ message: { role: 'assistant', content: 'Hello wor' }, done: false })],
    malformed: [
      jsonLine({ message: { role: 'assistant', content: 'A' }, done: false }),
      jsonLine('{garbled'),
      jsonLine({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }),
    ],
  },
  {
    name: 'gemini generate content',
    protocol: 'GoogleGemini',
    adapterId: 'google-gemini',
    api: 'google-gemini',
    contentType: 'text/event-stream',
    create: () => new GeminiProvider({ apiKey: 'fixture', baseUrl: BASE_URL }),
    complete: [gemini('Hello'), gemini('', 'STOP')],
    truncated: [gemini('Hello wor')],
    malformed: [gemini('A'), sse('{"candidates":[{'), gemini('', 'STOP')],
  },
  {
    name: 'openai responses',
    protocol: 'OpenAIResponses',
    adapterId: 'openai-responses',
    api: 'openai-responses',
    contentType: 'text/event-stream',
    create: () => new OpenAIResponsesProvider({ apiKey: 'fixture', baseUrl: BASE_URL }),
    complete: [
      ...responsesText,
      sse({ type: 'response.output_text.done', output_index: 0, item_id: 'msg_1', content_index: 0, text: 'Hello' }),
      sse({ type: 'response.output_item.done', output_index: 0, item: { id: 'msg_1', type: 'message' } }),
      sse({ type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } }),
    ],
    truncated: responsesText,
    malformed: [...responsesText, sse('{not json'), sse({ type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } })],
  },
];

function plan(family: WireFamily) {
  return createTestRequestPlan({
    providerId: 'fixture',
    adapterId: family.adapterId,
    catalogRevision: 'fixture',
    routeRevision: 'fixture',
    selectedModelId: 'm',
    effectiveModelId: 'm',
    appliedBindingIds: [],
    route: { protocol: family.protocol, baseUrl: BASE_URL, source: 'catalog' },
    headers: {},
    bodyPatch: {},
    contextBudgetTokens: 128_000,
    contextMode: 'normal',
    contextWindowTokens: 128_000,
    activeTierId: 'default',
    fastMode: false,
    reasoningWire: { selection: 'unknown', control: { kind: 'none' } },
  } as never);
}

async function run(family: WireFamily, frames: string[]): Promise<{ result?: unknown; error?: { code?: string } }> {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(frames.join(''), {
    status: 200,
    headers: { 'Content-Type': family.contentType },
  })));
  const model = { id: 'm', name: 'm', provider: 'fixture', api: family.api, contextWindow: 128_000, maxTokens: 1024 } as Model;
  const context = { systemPrompt: 'system', messages: [{ role: 'user', content: 'hi', timestamp: 1 }], tools: [] } as unknown as Context;
  const stream = family.create().stream(model, context, {
    requestPlan: plan(family),
    firstChunkTimeoutMs: 2_000,
    streamIdleTimeoutMs: 2_000,
  } as StreamOptions);
  try {
    for await (const _event of stream) {
      // Drain the stream so the adapter reaches its terminal handling.
    }
    return { result: await stream.result() };
  } catch (error) {
    return { error: error as { code?: string } };
  }
}

describe('provider stream terminal contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  for (const family of FAMILIES) {
    describe(family.name, () => {
      it('completes when the provider sends its terminal signal', async () => {
        const outcome = await run(family, family.complete);
        expect(outcome.error).toBeUndefined();
        expect(outcome.result).toMatchObject({ role: 'assistant' });
      });

      it('reports a stream that closes after output but before its terminal signal as truncated', async () => {
        const outcome = await run(family, family.truncated);
        expect(outcome.error?.code).toBe('PROVIDER_STREAM_TRUNCATED');
      });

      it('reports a frame that is not JSON as a protocol violation instead of skipping it', async () => {
        const outcome = await run(family, family.malformed);
        expect(outcome.error?.code).toBe('PROVIDER_STREAM_MALFORMED_FRAME');
      });
    });
  }
});
