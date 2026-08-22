import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderContractBundle } from '@shared/provider-catalog/modelManifestSchema';
import { createFailClosedProviderContracts } from '@shared/provider-catalog/providerContracts';
import type { LlmProviderProtocol } from '@shared/types/settings';
import type { ProviderAdapterId } from '@shared/provider-catalog/implementationRegistry';
import type { RequestPlan } from '@shared/types/providerCapability';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import type { AssistantMessage, Context, Model } from '../core/types';
import { AzureOpenAIResponsesProvider, __testing as azureTesting } from './AzureOpenAIResponsesProvider';
import { BedrockConverseProvider } from './BedrockConverseProvider';
import { GeminiProvider } from './GeminiProvider';
import { MistralProvider } from './MistralProvider';
import { OllamaProvider } from './OllamaProvider';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { OpenAIResponsesProvider, __testing as openaiTesting } from './OpenAIResponsesProvider';

const context: Context = {
  systemPrompt: 'Stay precise.',
  messages: [{ role: 'user', content: 'Think then answer.', timestamp: 1 }],
};

function model(api: Model['api']): Model {
  return {
    id: 'fixture-model',
    name: 'Fixture model',
    provider: 'fixture',
    api,
    contextWindow: 128_000,
    maxTokens: 4096,
    reasoning: true,
    vision: false,
  };
}

function responsesContracts(): ProviderContractBundle {
  const fallback = createFailClosedProviderContracts('OpenAIResponses');
  return {
    ...fallback,
    protocolDialect: 'OpenAIResponses',
    protocolVersion: '2026-01-01',
    compatibilityGroup: 'openai:OpenAIResponses',
    reasoning: {
      semantic: 'summary',
      source: 'openai-responses-summary',
      displayLabel: 'Reasoning summary',
      carrier: 'reasoning-item',
      artifactFormat: 'openai.responses.reasoning',
      artifactVersion: 'v1',
      compatibilityGroup: 'openai:OpenAIResponses',
      continuation: 'exact-execution',
      projectionSources: { summary: 'openai-responses-summary', opaque: 'openai-responses-encrypted' },
    },
    toolLoop: {
      artifactPolicy: 'preserve-exact',
      artifactScope: 'tool-call-turn',
      ordering: 'provider-native',
      modelSwitch: 'pin-until-terminal',
    },
  };
}

function plan(
  providerId: string,
  adapterId: ProviderAdapterId,
  protocol: LlmProviderProtocol,
  baseUrl: string,
  contracts?: ProviderContractBundle,
): RequestPlan {
  return createTestRequestPlan({
    providerId,
    adapterId,
    catalogRevision: 'stream-channel-identity',
    routeRevision: `${adapterId}-stream-channels`,
    selectedModelId: 'fixture-model',
    effectiveModelId: 'fixture-model',
    appliedBindingIds: [],
    route: { protocol, baseUrl, source: 'catalog', ...(contracts ? { contracts } : {}) },
    ...(contracts ? { contracts } : {}),
    headers: {},
    bodyPatch: {},
    contextBudgetTokens: 128_000,
    contextMode: 'normal',
    contextWindowTokens: 128_000,
    activeTierId: 'default',
    fastMode: false,
    reasoningWire: {
      selection: 'high',
      control: {
        kind: 'levels',
        supportsOff: true,
        levels: ['low', 'high'],
        defaultSelection: 'high',
        wireProfile: { kind: 'openai-responses', on: 'high', levels: { low: 'low', high: 'high' } },
      },
    },
  });
}

function sse(...events: Record<string, unknown>[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function jsonl(...rows: Record<string, unknown>[]): Response {
  return new Response(rows.map((row) => JSON.stringify(row)).join('\n'), {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

function thinkingBlocks(message: AssistantMessage) {
  return message.content.filter((block) => block.type === 'thinking');
}

function textBlocks(message: AssistantMessage) {
  return message.content.filter((block) => block.type === 'text');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAI Responses item-scoped stream channels', () => {
  const requestPlan = plan(
    'openai',
    'openai-responses',
    'OpenAIResponses',
    'https://api.openai.com/v1',
    responsesContracts(),
  );

  it('keeps one reasoning item open across multiple summary parts', async () => {
    vi.stubGlobal('fetch', async () => sse(
      { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_1' } },
      { type: 'response.reasoning_summary_text.delta', output_index: 0, item_id: 'rs_1', summary_index: 0, delta: 'first' },
      { type: 'response.reasoning_summary_text.done', output_index: 0, item_id: 'rs_1', summary_index: 0 },
      { type: 'response.reasoning_summary_text.delta', output_index: 0, item_id: 'rs_1', summary_index: 1, delta: 'second' },
      { type: 'response.reasoning_summary_text.done', output_index: 0, item_id: 'rs_1', summary_index: 1 },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_1' } },
      { type: 'response.output_item.added', output_index: 1, item: { type: 'message', id: 'msg_1' } },
      { type: 'response.output_text.delta', output_index: 1, item_id: 'msg_1', delta: 'Hello' },
      { type: 'response.output_item.done', output_index: 1, item: { type: 'message', id: 'msg_1' } },
      { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [{ type: 'reasoning', id: 'rs_1' }, { type: 'message', id: 'msg_1' }] } },
    ));

    const message = await new OpenAIResponsesProvider({ apiKey: 'secret' })
      .stream(model('openai-responses'), context, { requestPlan })
      .result();
    expect(thinkingBlocks(message)).toHaveLength(1);
    expect(thinkingBlocks(message)[0]).toMatchObject({ text: 'first\n\nsecond' });
    expect(textBlocks(message)).toEqual([expect.objectContaining({ text: 'Hello' })]);
  });

  it('assigns distinct refs to two reasoning items and replays each continuation once', async () => {
    const firstItem = { type: 'reasoning', id: 'rs_1', encrypted_content: 'enc_1' };
    const secondItem = { type: 'reasoning', id: 'rs_2', encrypted_content: 'enc_2' };
    vi.stubGlobal('fetch', async () => sse(
      { type: 'response.output_item.added', output_index: 0, item: firstItem },
      { type: 'response.reasoning_summary_text.delta', output_index: 0, item_id: 'rs_1', summary_index: 0, delta: 'one' },
      { type: 'response.output_item.done', output_index: 0, item: firstItem },
      { type: 'response.output_item.added', output_index: 1, item: secondItem },
      { type: 'response.reasoning_summary_text.delta', output_index: 1, item_id: 'rs_2', summary_index: 0, delta: 'two' },
      { type: 'response.output_item.done', output_index: 1, item: secondItem },
      { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [firstItem, secondItem] } },
    ));

    const message = await new OpenAIResponsesProvider({ apiKey: 'secret' })
      .stream(model('openai-responses'), context, { requestPlan })
      .result();
    const thinking = thinkingBlocks(message);
    expect(thinking).toHaveLength(2);
    expect(thinking[0]?.providerOutputRef?.providerBlockKey).toBe('output:reasoning:0');
    expect(thinking[1]?.providerOutputRef?.providerBlockKey).toBe('output:reasoning:1');
    expect(thinking[0]?.providerOutputRef?.providerBlockKey).not.toBe(thinking[1]?.providerOutputRef?.providerBlockKey);

    const replay = openaiTesting.toResponsesInput({
      messages: [
        { role: 'user', content: 'Think then answer.', timestamp: 1 },
        { ...message, content: [...message.content, { type: 'toolCall', id: 'call_1', name: 'lookup', arguments: { id: 1 } }] },
        {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'lookup',
          content: [{ type: 'text', text: 'ok' }],
          isError: false,
          timestamp: 2,
        },
      ],
    }, requestPlan);
    expect(replay.filter((item) => item && typeof item === 'object' && (item as { id?: string }).id === 'rs_1')).toHaveLength(1);
    expect(replay.filter((item) => item && typeof item === 'object' && (item as { id?: string }).id === 'rs_2')).toHaveLength(1);
  });

  it('keeps one message item open across two output_text parts', async () => {
    vi.stubGlobal('fetch', async () => sse(
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1' } },
      { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', content_index: 0, delta: 'Hello' },
      { type: 'response.output_text.done', output_index: 0, item_id: 'msg_1', content_index: 0 },
      { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', content_index: 1, delta: 'World' },
      { type: 'response.output_text.done', output_index: 0, item_id: 'msg_1', content_index: 1 },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_1' } },
      { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [{ type: 'message', id: 'msg_1' }] } },
    ));

    const message = await new OpenAIResponsesProvider({ apiKey: 'secret' })
      .stream(model('openai-responses'), context, { requestPlan })
      .result();
    expect(textBlocks(message)).toEqual([expect.objectContaining({ text: 'HelloWorld' })]);
  });

  it('opens a new reasoning block after a tool call', async () => {
    const firstItem = { type: 'reasoning', id: 'rs_1', encrypted_content: 'enc_1' };
    const secondItem = { type: 'reasoning', id: 'rs_2', encrypted_content: 'enc_2' };
    vi.stubGlobal('fetch', async () => sse(
      { type: 'response.output_item.added', output_index: 0, item: firstItem },
      { type: 'response.reasoning_summary_text.delta', output_index: 0, item_id: 'rs_1', summary_index: 0, delta: 'before' },
      { type: 'response.output_item.done', output_index: 0, item: firstItem },
      { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup' } },
      { type: 'response.function_call_arguments.delta', output_index: 1, item_id: 'fc_1', delta: '{"id":1}' },
      { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '{"id":1}' } },
      { type: 'response.output_item.added', output_index: 2, item: secondItem },
      { type: 'response.reasoning_summary_text.delta', output_index: 2, item_id: 'rs_2', summary_index: 0, delta: 'after' },
      { type: 'response.output_item.done', output_index: 2, item: secondItem },
      { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [firstItem, { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '{"id":1}' }, secondItem] } },
    ));

    const message = await new OpenAIResponsesProvider({ apiKey: 'secret' })
      .stream(model('openai-responses'), context, { requestPlan })
      .result();
    expect(thinkingBlocks(message).map((block) => block.providerOutputRef?.providerBlockKey)).toEqual([
      'output:reasoning:0',
      'output:reasoning:2',
    ]);
    expect(message.content.some((block) => block.type === 'toolCall' && block.id === 'call_1')).toBe(true);
  });
});

describe('Azure OpenAI Responses item-scoped stream channels', () => {
  const requestPlan = plan(
    'azure',
    'azure-openai-responses',
    'AzureOpenAIResponses',
    'https://azure.test',
    responsesContracts(),
  );

  it('accepts a second summary part on the same reasoning item', async () => {
    vi.stubGlobal('fetch', async () => sse(
      { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_1', encrypted_content: 'enc_1' } },
      { type: 'response.reasoning_summary_text.delta', output_index: 0, item_id: 'rs_1', summary_index: 0, delta: 'first' },
      { type: 'response.reasoning_summary_text.done', output_index: 0, item_id: 'rs_1', summary_index: 0 },
      { type: 'response.reasoning_summary_text.delta', output_index: 0, item_id: 'rs_1', summary_index: 1, delta: 'second' },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_1', encrypted_content: 'enc_1' } },
      { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [{ type: 'reasoning', id: 'rs_1', encrypted_content: 'enc_1' }] } },
    ));

    const message = await new AzureOpenAIResponsesProvider({ baseUrl: 'https://azure.test', apiKey: 'secret' })
      .stream(model('azure-openai-responses'), context, { requestPlan })
      .result();
    expect(thinkingBlocks(message)).toHaveLength(1);
    expect(thinkingBlocks(message)[0]).toMatchObject({ text: 'first\n\nsecond' });

    const replay = azureTesting.toResponsesInput({
      messages: [
        { role: 'user', content: 'Think then answer.', timestamp: 1 },
        { ...message, content: [...message.content, { type: 'toolCall', id: 'call_1', name: 'lookup', arguments: { id: 1 } }] },
      ],
    }, requestPlan);
    expect(replay.filter((item) => item && typeof item === 'object' && (item as { id?: string }).id === 'rs_1')).toHaveLength(1);
  });
});

describe('contiguous and protocol-scoped stream segments', () => {
  it('closes Bedrock thinking on contentBlockStop and opens a new block for the next index', async () => {
    vi.stubGlobal('fetch', async () => sse(
      { messageStart: { role: 'assistant' } },
      { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: 'one' } } } },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { contentBlockDelta: { contentBlockIndex: 1, delta: { reasoningContent: { text: 'two' } } } },
      { contentBlockStop: { contentBlockIndex: 1 } },
      { contentBlockDelta: { contentBlockIndex: 2, delta: { text: 'Hello' } } },
      { contentBlockStop: { contentBlockIndex: 2 } },
      { messageStop: { stopReason: 'end_turn' } },
    ));

    const message = await new BedrockConverseProvider({
      baseUrl: 'https://bedrock.test',
      requestAuthorizer: async ({ headers }) => headers,
    }).stream(
      model('bedrock-converse-stream'),
      context,
      { requestPlan: plan('amazon-bedrock', 'bedrock-converse-stream', 'BedrockConverseStream', 'https://bedrock.test') },
    ).result();

    expect(thinkingBlocks(message).map((block) => block.providerOutputRef?.providerBlockKey)).toEqual([
      'output:thinking:0',
      'output:thinking:1',
    ]);
    expect(textBlocks(message)).toEqual([expect.objectContaining({ text: 'Hello' })]);
  });

  it('opens a new Chat Completions thinking segment after a text switch', async () => {
    vi.stubGlobal('fetch', async () => sse(
      { choices: [{ index: 0, delta: { reasoning_content: 'one' } }] },
      { choices: [{ index: 0, delta: { content: 'hello' } }] },
      { choices: [{ index: 0, delta: { reasoning_content: 'two' } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ));

    const message = await new OpenAICompatibleProvider({ apiKey: 'secret', baseUrl: 'https://example.test/v1' })
      .stream(
        model('openai-compatible'),
        context,
        { requestPlan: plan('openai', 'openai-compatible', 'OpenAICompatibleChatCompletions', 'https://example.test/v1') },
      )
      .result();
    const thinking = thinkingBlocks(message);
    expect(thinking).toHaveLength(2);
    expect(thinking[0]?.providerOutputRef?.providerBlockKey).not.toBe(thinking[1]?.providerOutputRef?.providerBlockKey);
    expect(textBlocks(message)).toEqual([expect.objectContaining({ text: 'hello' })]);
  });

  it('opens a new Mistral thinking segment after a text switch', async () => {
    vi.stubGlobal('fetch', async () => sse(
      { choices: [{ delta: { reasoning_content: 'one' } }] },
      { choices: [{ delta: { content: 'hello' } }] },
      { choices: [{ delta: { reasoning_content: 'two' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ));

    const message = await new MistralProvider({ apiKey: 'secret', baseUrl: 'https://mistral.test/v1' })
      .stream(
        model('mistral-conversations'),
        context,
        { requestPlan: plan('mistral', 'mistral-conversations', 'MistralConversations', 'https://mistral.test/v1') },
      )
      .result();
    expect(thinkingBlocks(message)).toHaveLength(2);
  });

  it('opens a new Gemini thinking segment after a text switch', async () => {
    vi.stubGlobal('fetch', async () => sse(
      { candidates: [{ content: { parts: [{ text: 'one', thought: true }] } }] },
      { candidates: [{ content: { parts: [{ text: 'hello' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'two', thought: true }] }, finishReason: 'STOP' }] },
    ));

    const message = await new GeminiProvider({ apiKey: 'secret', baseUrl: 'https://generativelanguage.googleapis.com' })
      .stream(
        model('google-gemini'),
        context,
        { requestPlan: plan('google-ai-studio', 'google-gemini', 'GoogleGemini', 'https://generativelanguage.googleapis.com') },
      )
      .result();
    expect(thinkingBlocks(message)).toHaveLength(2);
    expect(textBlocks(message)).toEqual([expect.objectContaining({ text: 'hello' })]);
  });

  it('opens a new Ollama thinking segment after a text switch', async () => {
    vi.stubGlobal('fetch', async () => jsonl(
      { message: { role: 'assistant', thinking: 'one' }, done: false },
      { message: { role: 'assistant', content: 'hello' }, done: false },
      { message: { role: 'assistant', thinking: 'two' }, done: true, done_reason: 'stop' },
    ));

    const message = await new OllamaProvider({ baseUrl: 'http://localhost:11434' })
      .stream(
        model('ollama'),
        context,
        { requestPlan: plan('ollama', 'ollama-openai-compatible', 'OllamaOpenAICompatibleChatCompletions', 'http://localhost:11434') },
      )
      .result();
    expect(thinkingBlocks(message)).toHaveLength(2);
    expect(textBlocks(message)).toEqual([expect.objectContaining({ text: 'hello' })]);
  });
});
