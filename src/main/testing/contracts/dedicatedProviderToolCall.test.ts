import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LlmProviderProtocol } from '@shared/types/settings';
import type { ProviderAdapterId } from '@shared/provider-catalog/implementationRegistry';
import { createTestRequestPlan } from '../createTestRequestPlan';
import type { Context, Model } from '../../agent-runtime/core/types';
import { AzureOpenAIResponsesProvider } from '../../agent-runtime/providers/AzureOpenAIResponsesProvider';
import { BedrockConverseProvider } from '../../agent-runtime/providers/BedrockConverseProvider';
import { MistralProvider } from '../../agent-runtime/providers/MistralProvider';

const context: Context = {
  systemPrompt: 'Use tools precisely.',
  messages: [{ role: 'user', content: 'Look up id 1.', timestamp: 1 }],
  tools: [{
    name: 'lookup',
    description: 'Look up an id.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
  }],
};

function plan(
  providerId: string,
  adapterId: ProviderAdapterId,
  protocol: LlmProviderProtocol,
  baseUrl: string,
) {
  return createTestRequestPlan({
    providerId,
    adapterId,
    catalogRevision: 'dedicated-provider-contract',
    routeRevision: `${adapterId}-tool-call`,
    selectedModelId: 'fixture-model',
    effectiveModelId: 'fixture-model',
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
      control: {
        kind: 'none',
        supportsOff: true,
        levels: [],
        defaultSelection: 'off',
        wireProfile: { kind: 'none' },
      },
    },
  });
}

const azureModel: Model = {
  id: 'fixture-model', name: 'Fixture Azure model', provider: 'azure', api: 'azure-openai-responses',
  contextWindow: 128_000, maxTokens: 4096, reasoning: false, vision: false,
};
const mistralModel: Model = {
  id: 'fixture-model', name: 'Fixture Mistral model', provider: 'mistral', api: 'mistral-conversations',
  contextWindow: 128_000, maxTokens: 4096, reasoning: false, vision: false,
};
const bedrockModel: Model = {
  id: 'fixture-model', name: 'Fixture Bedrock model', provider: 'amazon-bedrock', api: 'bedrock-converse-stream',
  contextWindow: 128_000, maxTokens: 4096, reasoning: false, vision: false,
};

function sse(...events: Record<string, unknown>[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dedicated structured-tool provider adapters', () => {
  it('sends Azure Responses tools and reconstructs a streamed function call', async () => {
    let request: RequestInit | undefined;
    vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      request = init;
      return sse(
        { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup' } },
        { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_1', delta: '{"id":1}' },
        { type: 'response.function_call_arguments.done', output_index: 0, item_id: 'fc_1', arguments: '{"id":1}' },
        { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '{"id":1}' } },
        { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '{"id":1}' }], usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } } },
      );
    });

    const message = await new AzureOpenAIResponsesProvider({ baseUrl: 'https://azure.test', apiKey: 'secret' })
      .stream(azureModel, context, { requestPlan: plan('azure', 'azure-openai-responses', 'AzureOpenAIResponses', 'https://azure.test') })
      .result();

    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'fixture-model', stream: true, tool_choice: 'auto' });
    expect(body.tools).toEqual([expect.objectContaining({ type: 'function', name: 'lookup' })]);
    expect(message.stopReason).toBe('toolUse');
    expect(message.content).toEqual([expect.objectContaining({ type: 'toolCall', id: 'call_1', name: 'lookup', arguments: { id: 1 } })]);
  });

  it('sends Mistral tools and reconstructs Chat Completions tool calls', async () => {
    let request: RequestInit | undefined;
    vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      request = init;
      return sse(
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"id":1}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
      );
    });

    const message = await new MistralProvider({ baseUrl: 'https://mistral.test/v1', apiKey: 'secret' })
      .stream(mistralModel, context, { requestPlan: plan('mistral', 'mistral-conversations', 'MistralConversations', 'https://mistral.test/v1') })
      .result();

    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'fixture-model', stream: true, tool_choice: 'auto' });
    expect(body.tools).toEqual([expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'lookup' }) })]);
    expect(message.stopReason).toBe('toolUse');
    expect(message.content).toEqual([expect.objectContaining({ type: 'toolCall', id: 'call_1', name: 'lookup', arguments: { id: 1 } })]);
  });

  it('sends Bedrock toolConfig and reconstructs Converse toolUse events', async () => {
    let request: RequestInit | undefined;
    vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      request = init;
      return sse(
        { messageStart: { role: 'assistant' } },
        { contentBlockStart: { contentBlockIndex: 0, start: { toolUse: { toolUseId: 'tool_1', name: 'lookup' } } } },
        { contentBlockDelta: { contentBlockIndex: 0, delta: { toolUse: { input: '{"id":1}' } } } },
        { contentBlockStop: { contentBlockIndex: 0 } },
        { messageStop: { stopReason: 'tool_use' } },
        { metadata: { usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } } },
      );
    });

    const message = await new BedrockConverseProvider({ baseUrl: 'https://bedrock.test', requestAuthorizer: async ({ headers }) => ({ ...headers, authorization: 'sigv4-fixture' }) })
      .stream(bedrockModel, context, { requestPlan: plan('amazon-bedrock', 'bedrock-converse-stream', 'BedrockConverseStream', 'https://bedrock.test') })
      .result();

    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ toolConfig: { toolChoice: { auto: {} } } });
    expect((body.toolConfig as { tools: unknown[] }).tools).toEqual([expect.objectContaining({ toolSpec: expect.objectContaining({ name: 'lookup' }) })]);
    expect(message.stopReason).toBe('toolUse');
    expect(message.content).toEqual([expect.objectContaining({ type: 'toolCall', id: 'tool_1', name: 'lookup', arguments: { id: 1 } })]);
  });
});
