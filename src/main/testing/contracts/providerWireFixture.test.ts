/**
 * Provider wire fixture matrix (Phase 7 contract entry).
 *
 * Locks desensitized SSE/JSONL fixtures under
 * `src/main/agent-runtime/providers/__fixtures__/` and basic parse/wire
 * contracts per adapter. Deeper suites remain in AssistantStreamBuilder,
 * reasoningWire, AccountStreamRetry, and adapter-specific provider tests.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { createFailClosedProviderContracts } from '@shared/provider-catalog/providerContracts';
import { PROTOCOL_WIRE_FIXTURE_COVERAGE } from '@shared/provider-catalog/protocolWireFixtureCoverage';
import type { LlmProviderProtocol } from '@shared/types/settings';
import type { ProviderAdapterId } from '@shared/provider-catalog/implementationRegistry';
import type { RequestPlan } from '@shared/types/providerCapability';
import { buildProviderOperationTarget } from '../../agent-runtime/providers/ProviderOperationRegistry';
import { buildAnthropicMessagesUrl } from '../../agent-runtime/providers/AnthropicProvider';
import { buildGeminiStreamUrl } from '../../agent-runtime/providers/GeminiProvider';
import { createTestRequestPlan } from '../createTestRequestPlan';
import type { Context, Model } from '../../agent-runtime/core/types';
import { EventStream } from '../../agent-runtime/core/EventStream';
import type { AssistantMessage, AssistantMessageEvent } from '../../agent-runtime/core/types';
import {
  AssistantStreamBuilder,
  createProviderOutputRef,
  ProviderStreamProtocolError,
} from '../../agent-runtime/providers/internal/AssistantStreamBuilder';
import {
  parseJsonLines,
  parseSSE,
  ProviderStreamBufferError,
} from '../../agent-runtime/providers/internal/http';
import { requestPlanHeaders } from '../../agent-runtime/providers/requestPlanWire';
import {
  applyOpenAiCompatibleReasoning,
  buildOpenAiResponsesReasoning,
} from '../../agent-runtime/providers/reasoningWire';
import { __testing as openAICompatibleTesting } from '../../agent-runtime/providers/OpenAICompatibleProvider';
import { __testing as openAIResponsesTesting } from '../../agent-runtime/providers/OpenAIResponsesProvider';
import { __testing as anthropicTesting } from '../../agent-runtime/providers/AnthropicProvider';
import { __testing as geminiTesting } from '../../agent-runtime/providers/GeminiProvider';
import { __testing as ollamaTesting } from '../../agent-runtime/providers/OllamaProvider';
import { __testing as azureTesting } from '../../agent-runtime/providers/AzureOpenAIResponsesProvider';
import { __testing as mistralTesting } from '../../agent-runtime/providers/MistralProvider';
import { __testing as bedrockTesting } from '../../agent-runtime/providers/BedrockConverseProvider';
import { buildGoogleInteractionsRequest } from '../../agent-runtime/providers/GoogleInteractionsWire';

const FIXTURE_ROOT = path.join(__dirname, '../../agent-runtime/providers/__fixtures__');

const SECRET_HEADERS = {
  authorization: 'Bearer sk-fixture-must-not-appear',
  'x-api-key': 'fixture-api-key',
  'x-goog-api-key': 'fixture-goog-key',
  cookie: 'session=fixture',
} as const;

type StreamTransport = 'sse' | 'jsonl';

interface AdapterFixtureSpec {
  dir: string;
  adapterId: ProviderAdapterId;
  protocol: LlmProviderProtocol;
  streamFile: string;
  transport: StreamTransport;
  providerId: string;
  modelId: string;
  connectionValues?: Readonly<Record<string, string>>;
}

const ADAPTER_FIXTURES: readonly AdapterFixtureSpec[] = [
  {
    dir: 'openai-compatible',
    adapterId: 'openai-compatible',
    protocol: 'OpenAICompatibleChatCompletions',
    streamFile: 'stream.sse',
    transport: 'sse',
    providerId: 'openai-compatible',
    modelId: 'fixture-chat',
  },
  {
    dir: 'openai-responses',
    adapterId: 'openai-responses',
    protocol: 'OpenAIResponses',
    streamFile: 'stream.sse',
    transport: 'sse',
    providerId: 'openai',
    modelId: 'fixture-responses',
  },
  {
    dir: 'anthropic',
    adapterId: 'anthropic-messages',
    protocol: 'AnthropicMessages',
    streamFile: 'stream.sse',
    transport: 'sse',
    providerId: 'anthropic',
    modelId: 'claude-fixture',
  },
  {
    dir: 'gemini',
    adapterId: 'google-gemini',
    protocol: 'GoogleGemini',
    streamFile: 'stream.sse',
    transport: 'sse',
    providerId: 'google-gemini',
    modelId: 'gemini-fixture',
  },
  {
    dir: 'google-interactions',
    adapterId: 'google-interactions',
    protocol: 'GoogleInteractions',
    streamFile: 'stream.sse',
    transport: 'sse',
    providerId: 'google-ai-studio',
    modelId: 'gemini-interactions-fixture',
  },
  {
    dir: 'ollama',
    adapterId: 'ollama-openai-compatible',
    protocol: 'OllamaOpenAICompatibleChatCompletions',
    streamFile: 'stream.jsonl',
    transport: 'jsonl',
    providerId: 'ollama',
    modelId: 'fixture-model',
  },
  {
    dir: 'azure-openai-responses',
    adapterId: 'azure-openai-responses',
    protocol: 'AzureOpenAIResponses',
    streamFile: 'stream.sse',
    transport: 'sse',
    providerId: 'azure-cognitive-services',
    modelId: 'fixture-azure',
  },
  {
    dir: 'mistral-conversations',
    adapterId: 'mistral-conversations',
    protocol: 'MistralConversations',
    streamFile: 'stream.sse',
    transport: 'sse',
    providerId: 'mistral',
    modelId: 'mistral-fixture',
  },
  {
    dir: 'bedrock-converse-stream',
    adapterId: 'bedrock-converse-stream',
    protocol: 'BedrockConverseStream',
    streamFile: 'stream.sse',
    transport: 'sse',
    providerId: 'amazon-bedrock',
    modelId: 'fixture-bedrock',
  },
  {
    dir: 'azure-openai-chat',
    adapterId: 'azure-openai-chat',
    protocol: 'AzureOpenAIChatCompletions',
    streamFile: 'stream.sse',
    transport: 'sse',
    providerId: 'azure',
    modelId: 'fixture-azure-chat',
  },
  {
    dir: 'openrouter-chat',
    adapterId: 'openrouter-chat',
    protocol: 'OpenRouterChatCompletions',
    streamFile: 'stream.sse',
    transport: 'sse',
    providerId: 'openrouter',
    modelId: 'fixture-openrouter',
  },
  {
    dir: 'google-vertex-gemini',
    adapterId: 'google-vertex-gemini',
    protocol: 'GoogleVertexGemini',
    streamFile: 'stream.sse',
    transport: 'sse',
    providerId: 'google-vertex',
    modelId: 'fixture-vertex-gemini',
  },
  {
    dir: 'google-vertex-anthropic',
    adapterId: 'google-vertex-anthropic',
    protocol: 'GoogleVertexAnthropic',
    streamFile: 'stream.sse',
    transport: 'sse',
    providerId: 'google-vertex-anthropic',
    modelId: 'fixture-vertex-anthropic',
  },
  {
    dir: 'gitlab-duo',
    adapterId: 'gitlab-duo',
    protocol: 'GitLabDuo',
    streamFile: 'stream.jsonl',
    transport: 'jsonl',
    providerId: 'gitlab',
    modelId: 'fixture-duo',
  },
  {
    dir: 'sap-ai-core-orchestration',
    adapterId: 'sap-ai-core-orchestration',
    protocol: 'SapAiCoreOrchestration',
    streamFile: 'stream.jsonl',
    transport: 'jsonl',
    providerId: 'sap-ai-core',
    modelId: 'fixture-sap-orchestration',
    connectionValues: { AICORE_DEPLOYMENT_ID: 'fixture-deployment' },
  },
  {
    dir: 'sap-ai-core-foundation-models',
    adapterId: 'sap-ai-core-foundation-models',
    protocol: 'SapAiCoreFoundationModels',
    streamFile: 'stream.jsonl',
    transport: 'jsonl',
    providerId: 'sap-ai-core',
    modelId: 'fixture-sap-foundation',
    connectionValues: { AICORE_DEPLOYMENT_ID: 'fixture-deployment' },
  },
];

const FIXTURE_CONTEXT: Context = {
  systemPrompt: 'Stay precise.',
  messages: [{ role: 'user', content: 'Read README.md', timestamp: 1 }],
  tools: [{
    name: 'read_file',
    description: 'Read a workspace file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  }],
};

function fixtureDir(spec: AdapterFixtureSpec): string {
  return path.join(FIXTURE_ROOT, spec.dir);
}

function buildPlan(spec: AdapterFixtureSpec): RequestPlan {
  return createTestRequestPlan({
    providerId: spec.providerId,
    adapterId: spec.adapterId,
    catalogRevision: 'wire-fixture-catalog',
    routeRevision: `wire-fixture-${spec.dir}`,
    selectedModelId: spec.modelId,
    effectiveModelId: spec.modelId,
    appliedBindingIds: [],
    route: {
      protocol: spec.protocol,
      baseUrl: 'https://example.test/v1',
      source: 'catalog',
    },
    headers: {
      'x-rdc-activation': 'fixture',
      ...SECRET_HEADERS,
    },
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

function fixtureModel(spec: AdapterFixtureSpec): Model {
  return {
    id: spec.modelId,
    name: spec.modelId,
    provider: spec.providerId,
    api: spec.dir,
    contextWindow: 128_000,
    maxTokens: 4096,
    reasoning: false,
    vision: false,
  };
}

async function loadStreamPayloads(spec: AdapterFixtureSpec): Promise<string[]> {
  const raw = readFileSync(path.join(fixtureDir(spec), spec.streamFile), 'utf8');
  const response = new Response(raw, {
    status: 200,
    headers: {
      'Content-Type': spec.transport === 'sse' ? 'text/event-stream' : 'application/x-ndjson',
    },
  });
  const payloads: string[] = [];
  if (spec.transport === 'sse') {
    for await (const data of parseSSE(response, undefined, { providerApi: spec.dir })) {
      payloads.push(data);
    }
  } else {
    for await (const line of parseJsonLines(response, undefined, { providerApi: spec.dir })) {
      payloads.push(line);
    }
  }
  return payloads;
}

function parseJsonObjects(payloads: string[]): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  for (const payload of payloads) {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        objects.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Malformed lines are skipped the same way adapters skip bad chunks.
    }
  }
  return objects;
}

function assertTextAndToolCall(spec: AdapterFixtureSpec, events: Record<string, unknown>[]): void {
  const blob = JSON.stringify(events);
  expect(blob).toMatch(/Hello|world/i);
  expect(blob).toMatch(/read_file/);

  switch (spec.dir) {
    case 'openai-compatible': {
      const hasText = events.some((event) => {
        const choice = (event.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = choice?.delta as Record<string, unknown> | undefined;
        return typeof delta?.content === 'string' && delta.content.length > 0;
      });
      const hasTool = events.some((event) => {
        const choice = (event.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = choice?.delta as Record<string, unknown> | undefined;
        return Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0;
      });
      expect(hasText).toBe(true);
      expect(hasTool).toBe(true);
      break;
    }
    case 'openai-responses': {
      const types = events.map((event) => event.type);
      expect(types).toContain('response.output_text.delta');
      expect(types).toContain('response.output_item.added');
      expect(types).toContain('response.function_call_arguments.delta');
      break;
    }
    case 'anthropic': {
      const types = events.map((event) => event.type);
      expect(types).toContain('content_block_start');
      expect(types).toContain('content_block_delta');
      expect(events.some((event) => {
        const block = event.content_block as Record<string, unknown> | undefined;
        return block?.type === 'tool_use' || block?.type === 'text';
      })).toBe(true);
      expect(events.some((event) => {
        const delta = event.delta as Record<string, unknown> | undefined;
        return delta?.type === 'text_delta' || delta?.type === 'input_json_delta';
      })).toBe(true);
      break;
    }
    case 'gemini': {
      const parts = events.flatMap((event) => {
        const candidate = (event.candidates as Array<Record<string, unknown>> | undefined)?.[0];
        const content = candidate?.content as Record<string, unknown> | undefined;
        return (content?.parts as Array<Record<string, unknown>> | undefined) ?? [];
      });
      expect(parts.some((part) => typeof part.text === 'string')).toBe(true);
      expect(parts.some((part) => part.functionCall && typeof part.functionCall === 'object')).toBe(true);
      break;
    }
    case 'google-interactions': {
      const types = events.map((event) => event.event_type);
      expect(types).toContain('step.start');
      expect(types).toContain('step.delta');
      expect(events.some((event) => {
        const step = event.step as Record<string, unknown> | undefined;
        return step?.type === 'function_call' || step?.type === 'text';
      })).toBe(true);
      break;
    }
    case 'ollama': {
      expect(events.some((event) => {
        const message = event.message as Record<string, unknown> | undefined;
        return typeof message?.content === 'string' && message.content.length > 0;
      })).toBe(true);
      expect(events.some((event) => {
        const message = event.message as Record<string, unknown> | undefined;
        return Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
      })).toBe(true);
      expect(events.some((event) => event.done === true)).toBe(true);
      break;
    }
    case 'mistral-conversations': {
      const hasText = events.some((event) => {
        const choice = (event.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = choice?.delta as Record<string, unknown> | undefined;
        return typeof delta?.content === 'string' && delta.content.length > 0;
      });
      const hasTool = events.some((event) => {
        const choice = (event.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = choice?.delta as Record<string, unknown> | undefined;
        return Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0;
      });
      expect(hasText).toBe(true);
      expect(hasTool).toBe(true);
      break;
    }
    case 'azure-openai-responses': {
      const types = events.map((event) => event.type);
      expect(types).toContain('response.output_text.delta');
      expect(types).toContain('response.function_call_arguments.delta');
      break;
    }
    case 'bedrock-converse-stream': {
      expect(events.some((event) => event.contentBlockDelta)).toBe(true);
      expect(JSON.stringify(events)).toMatch(/read_file/);
      break;
    }
    case 'azure-openai-chat':
    case 'openrouter-chat': {
      const hasText = events.some((event) => {
        const choice = (event.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = choice?.delta as Record<string, unknown> | undefined;
        return typeof delta?.content === 'string' && delta.content.length > 0;
      });
      const hasTool = events.some((event) => {
        const choice = (event.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = choice?.delta as Record<string, unknown> | undefined;
        return Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0;
      });
      expect(hasText).toBe(true);
      expect(hasTool).toBe(true);
      break;
    }
    case 'google-vertex-gemini': {
      const parts = events.flatMap((event) => {
        const candidate = (event.candidates as Array<Record<string, unknown>> | undefined)?.[0];
        const content = candidate?.content as Record<string, unknown> | undefined;
        return (content?.parts as Array<Record<string, unknown>> | undefined) ?? [];
      });
      expect(parts.some((part) => typeof part.text === 'string')).toBe(true);
      expect(parts.some((part) => part.functionCall && typeof part.functionCall === 'object')).toBe(true);
      break;
    }
    case 'google-vertex-anthropic': {
      const types = events.map((event) => event.type);
      expect(types).toContain('content_block_start');
      expect(types).toContain('content_block_delta');
      expect(events.some((event) => {
        const block = event.content_block as Record<string, unknown> | undefined;
        return block?.type === 'tool_use' || block?.type === 'text';
      })).toBe(true);
      break;
    }
    case 'gitlab-duo':
    case 'sap-ai-core-orchestration':
    case 'sap-ai-core-foundation-models': {
      expect(events.some((event) => event.type === 'text-delta')).toBe(true);
      expect(events.some((event) => event.type === 'tool-call')).toBe(true);
      break;
    }
    default:
      throw new Error(`Unhandled fixture dir: ${spec.dir}`);
  }
}

function assertWireBody(spec: AdapterFixtureSpec, plan: RequestPlan): void {
  const model = fixtureModel(spec);
  switch (spec.dir) {
    case 'openai-compatible': {
      const messages = openAICompatibleTesting.toOpenAIMessages(FIXTURE_CONTEXT, plan);
      expect(messages.some((message) => message.role === 'system')).toBe(true);
      expect(messages.some((message) => message.role === 'user')).toBe(true);
      expect(openAICompatibleTesting.buildChatCompletionsUrl(plan.route.baseUrl ?? '')).toMatch(/\/chat\/completions$/);
      break;
    }
    case 'openai-responses': {
      const body = openAIResponsesTesting.buildRequestBody(model, FIXTURE_CONTEXT, { requestPlan: plan });
      expect(body).toMatchObject({
        model: model.id,
        stream: true,
        tool_choice: 'auto',
      });
      expect(Array.isArray(body.input)).toBe(true);
      expect(Array.isArray(body.tools)).toBe(true);
      break;
    }
    case 'anthropic': {
      const { system, messages } = anthropicTesting.toAnthropicMessages(FIXTURE_CONTEXT, plan);
      expect(typeof system === 'string' || Array.isArray(system)).toBe(true);
      expect(messages.some((message) => message.role === 'user')).toBe(true);
      break;
    }
    case 'gemini': {
      const { systemInstruction, contents } = geminiTesting.toGeminiContents(FIXTURE_CONTEXT, plan);
      expect(systemInstruction).toBe('Stay precise.');
      expect(contents[0]).toMatchObject({ role: 'user' });
      break;
    }
    case 'google-interactions': {
      const body = buildGoogleInteractionsRequest(model, FIXTURE_CONTEXT, { requestPlan: plan });
      expect(body).toMatchObject({
        model: model.id,
        stream: true,
        system_instruction: 'Stay precise.',
      });
      expect(Array.isArray(body.input)).toBe(true);
      expect(Array.isArray(body.tools)).toBe(true);
      break;
    }
    case 'ollama': {
      const messages = ollamaTesting.toOllamaMessages(FIXTURE_CONTEXT);
      expect(messages[0]).toMatchObject({ role: 'system', content: 'Stay precise.' });
      expect(messages.some((message) => message.role === 'user')).toBe(true);
      break;
    }
    case 'mistral-conversations': {
      const messages = mistralTesting.toMistralMessages(FIXTURE_CONTEXT, plan);
      expect(messages.some((message) => message.role === 'system' || message.role === 'user')).toBe(true);
      expect(mistralTesting.buildMistralChatCompletionsUrl(plan.route.baseUrl ?? '')).toMatch(/\/chat\/completions$/);
      break;
    }
    case 'azure-openai-responses': {
      const body = azureTesting.buildRequestBody(model, FIXTURE_CONTEXT, { requestPlan: plan });
      expect(body).toMatchObject({
        model: model.id,
        stream: true,
      });
      break;
    }
    case 'bedrock-converse-stream': {
      const messages = bedrockTesting.toBedrockMessages(FIXTURE_CONTEXT);
      expect(messages.some((message) => message.role === 'user')).toBe(true);
      break;
    }
    case 'azure-openai-chat': {
      const messages = openAICompatibleTesting.toOpenAIMessages(FIXTURE_CONTEXT, plan);
      expect(messages.some((message) => message.role === 'user')).toBe(true);
      expect(openAICompatibleTesting.buildChatCompletionsUrl(plan.route.baseUrl ?? '', {
        'api-version': '2024-10-21',
      })).toMatch(/\/chat\/completions\?api-version=/);
      break;
    }
    case 'openrouter-chat': {
      const messages = openAICompatibleTesting.toOpenAIMessages(FIXTURE_CONTEXT, plan);
      expect(messages.some((message) => message.role === 'user')).toBe(true);
      expect(openAICompatibleTesting.buildChatCompletionsUrl(plan.route.baseUrl ?? '')).toMatch(/\/chat\/completions$/);
      break;
    }
    case 'google-vertex-gemini': {
      const { systemInstruction, contents } = geminiTesting.toGeminiContents(FIXTURE_CONTEXT, plan);
      expect(systemInstruction).toBe('Stay precise.');
      expect(contents[0]).toMatchObject({ role: 'user' });
      expect(buildGeminiStreamUrl(plan.route.baseUrl ?? '', spec.modelId, 'unused', 'vertex'))
        .toMatch(/:streamGenerateContent\?alt=sse$/);
      break;
    }
    case 'google-vertex-anthropic': {
      const { system, messages } = anthropicTesting.toAnthropicMessages(FIXTURE_CONTEXT, plan);
      expect(typeof system === 'string' || Array.isArray(system)).toBe(true);
      expect(messages.some((message) => message.role === 'user')).toBe(true);
      expect(buildAnthropicMessagesUrl(plan.route.baseUrl ?? '', spec.modelId, 'vertex'))
        .toMatch(/:streamRawPredict$/);
      break;
    }
    case 'gitlab-duo':
    case 'sap-ai-core-orchestration':
    case 'sap-ai-core-foundation-models': {
      const target = buildProviderOperationTarget({
        adapterId: spec.adapterId,
        protocol: spec.protocol,
        baseUrl: plan.route.baseUrl ?? 'https://example.test',
        modelId: spec.modelId,
        connectionValues: spec.connectionValues,
      });
      expect(target.transport).toBe('sdk');
      if (spec.dir === 'gitlab-duo') {
        expect(target.url).toMatch(/duo_workflows\/ws/);
      } else if (spec.dir === 'sap-ai-core-orchestration') {
        expect(target.url).toMatch(/\/inference\/deployments\/fixture-deployment\/v2\/completion$/);
      } else {
        expect(target.url).toMatch(/\/inference\/deployments\/fixture-deployment\/chat\/completions$/);
      }
      break;
    }
    default:
      throw new Error(`Unhandled fixture dir: ${spec.dir}`);
  }
}

describe('providerWireFixture matrix', () => {
  it('covers every native protocol in the shared fixture map', () => {
    const dirs = new Set(ADAPTER_FIXTURES.map((spec) => spec.dir));
    for (const [protocol, coverage] of Object.entries(PROTOCOL_WIRE_FIXTURE_COVERAGE)) {
      expect(dirs.has(coverage.dir), protocol).toBe(true);
      expect(ADAPTER_FIXTURES.some((spec) => (
        spec.protocol === protocol && spec.adapterId === coverage.adapterId
      ))).toBe(true);
    }
  });

  it('keeps a closed fixture tree for every required adapter', () => {
    const dirs = readdirSync(FIXTURE_ROOT).filter((name) => {
      try {
        return statSync(path.join(FIXTURE_ROOT, name)).isDirectory();
      } catch {
        return false;
      }
    }).sort();
    expect(dirs).toEqual([...ADAPTER_FIXTURES.map((spec) => spec.dir)].sort());
    for (const spec of ADAPTER_FIXTURES) {
      const dir = fixtureDir(spec);
      expect(statSync(path.join(dir, spec.streamFile)).isFile()).toBe(true);
      expect(statSync(path.join(dir, 'expected.md')).isFile()).toBe(true);
      const notes = readFileSync(path.join(dir, 'expected.md'), 'utf8');
      expect(notes.length).toBeGreaterThan(40);
      expect(notes).not.toMatch(/out of scope|TODO later|skeleton/i);
    }
  });

  for (const spec of ADAPTER_FIXTURES) {
    describe(spec.dir, () => {
      it('builds a fail-closed RequestPlan without secret headers', () => {
        const plan = buildPlan(spec);
        expect(plan.adapterId).toBe(spec.adapterId);
        expect(plan.route.protocol).toBe(spec.protocol);
        const contracts = plan.route.contracts ?? createFailClosedProviderContracts(plan.route.protocol);
        expect(contracts.semanticContext.attachments).toBe('fail-closed');
        expect(contracts.reasoning.semantic).toBe('unknown');
        expect(plan.headers.authorization).toBe(SECRET_HEADERS.authorization);
        const safeHeaders = requestPlanHeaders(plan);
        expect(safeHeaders).toEqual({ 'x-rdc-activation': 'fixture' });
        expect(JSON.stringify(safeHeaders)).not.toMatch(/sk-fixture|fixture-api-key|fixture-goog-key|session=fixture/);
      });

      it('parses the golden stream fixture for text + tool_call', async () => {
        const payloads = await loadStreamPayloads(spec);
        expect(payloads.length).toBeGreaterThan(0);
        const events = parseJsonObjects(payloads);
        expect(events.length).toBeGreaterThan(0);
        assertTextAndToolCall(spec, events);
      });

      it('builds a known request wire shape via provider helpers', () => {
        assertWireBody(spec, buildPlan(spec));
      });
    });
  }
});

describe('providerWireFixture fail-closed stream invariants', () => {
  function makeBuilder() {
    const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
      (event) => event.type === 'done',
      (event) => (event as Extract<AssistantMessageEvent, { type: 'done' }>).message,
    );
    const builder = new AssistantStreamBuilder(stream, 'model', 'provider');
    builder.start();
    return builder;
  }

  it('rejects kind collision on one ProviderOutputRef (matrix lock)', () => {
    const builder = makeBuilder();
    const ref = createProviderOutputRef({
      protocol: 'fixture',
      providerBlockKey: 'block:0',
      sourceIndex: 0,
      contentIndex: 0,
    });
    builder.startText(ref);
    expect(() => builder.startThinking(ref, {
      kind: 'raw',
      source: 'unknown',
      visibility: 'raw-collapsed',
    })).toThrowError(expect.objectContaining({
      code: 'PROVIDER_STREAM_CHANNEL_COLLISION',
    }) as ProviderStreamProtocolError);
  });

  it('rejects delta before block start (matrix lock)', () => {
    const builder = makeBuilder();
    const ref = createProviderOutputRef({
      protocol: 'fixture',
      providerBlockKey: 'block:1',
      sourceIndex: 1,
      contentIndex: 1,
    });
    expect(() => builder.appendText(ref, 'early')).toThrowError(expect.objectContaining({
      code: 'PROVIDER_STREAM_DELTA_BEFORE_START',
    }) as ProviderStreamProtocolError);
  });

  it('aborts mid-stream and discards late EventStream output', async () => {
    const raw = new EventStream<string, string>();
    raw.push('early');
    raw.abort();
    raw.push('late-after-abort');
    expect(raw.signal.aborted).toBe(true);
    const seen: string[] = [];
    await expect(async () => {
      for await (const event of raw) {
        seen.push(event);
      }
    }).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toEqual(['early']);

    const builder = makeBuilder();
    const textRef = createProviderOutputRef({
      protocol: 'fixture',
      providerBlockKey: 'text:abort',
      sourceIndex: 0,
      contentIndex: 0,
    });
    builder.startText(textRef);
    builder.appendText(textRef, 'partial');
    const abortErr = new Error('fixture abort');
    abortErr.name = 'AbortError';
    builder.fail(abortErr, 'aborted');
    expect(() => builder.appendText(textRef, 'late')).toThrowError(expect.objectContaining({
      code: 'PROVIDER_STREAM_EVENT_AFTER_TERMINAL',
    }) as ProviderStreamProtocolError);
  });

  it('fail-closes oversized / truncated SSE buffers', async () => {
    const oversized = `data: ${'{"x":"'.padEnd(64, 'a')}\n`;
    const response = new Response(oversized, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
    await expect(async () => {
      for await (const _ of parseSSE(response, undefined, {
        providerApi: 'openai-compatible',
        maxBufferBytes: 16,
      })) {
        // consume
      }
    }).rejects.toBeInstanceOf(ProviderStreamBufferError);

    const truncated = readFileSync(
      path.join(FIXTURE_ROOT, 'openai-compatible', 'stream-truncated.sse'),
      'utf8',
    );
    const truncatedResponse = new Response(truncated, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
    const payloads: string[] = [];
    for await (const data of parseSSE(truncatedResponse, undefined, {
      providerApi: 'openai-compatible',
    })) {
      payloads.push(data);
    }
    // Consumers must fail-closed: only well-formed JSON objects are accepted.
    const parsed = parseJsonObjects(payloads);
    expect(parsed.length).toBeGreaterThan(0);
    expect(JSON.stringify(parsed)).toMatch(/"content":"ok"/);
    expect(JSON.stringify(parsed)).not.toMatch(/incomplete/);

    const builder = makeBuilder();
    const badRef = createProviderOutputRef({
      protocol: 'fixture',
      providerBlockKey: 'tool:malformed',
      sourceIndex: 3,
      contentIndex: 3,
    });
    expect(() => builder.appendToolCallArgs(badRef, '{"path":')).toThrowError(
      expect.objectContaining({ code: 'PROVIDER_STREAM_DELTA_BEFORE_START' }) as ProviderStreamProtocolError,
    );
  });

  it('maps reasoning wire when selection is present', () => {
    const openAiResponses = buildOpenAiResponsesReasoning({
      selection: 'high',
      control: {
        kind: 'levels',
        supportsOff: true,
        levels: ['low', 'medium', 'high'],
        defaultSelection: 'medium',
        wireProfile: {
          kind: 'openai-responses',
          on: 'medium',
          levels: { low: 'low', medium: 'medium', high: 'high' },
        },
      },
    });
    expect(openAiResponses.reasoning).toMatchObject({ effort: 'high' });

    const body: Record<string, unknown> = { model: 'fixture-chat', stream: true };
    applyOpenAiCompatibleReasoning(body, {
      selection: 'medium',
      control: {
        kind: 'levels',
        supportsOff: true,
        levels: ['low', 'medium', 'high'],
        defaultSelection: 'medium',
        wireProfile: {
          kind: 'openai-compatible',
          on: 'medium',
          levels: { low: 'low', medium: 'medium', high: 'high' },
        },
      },
    });
    expect(body.reasoning_effort).toBe('medium');

    const reasoningFixture = readFileSync(
      path.join(FIXTURE_ROOT, 'openai-compatible', 'stream-reasoning.sse'),
      'utf8',
    );
    expect(reasoningFixture).toMatch(/reasoning_content/);
    expect(reasoningFixture).not.toMatch(/sk-fixture|Bearer |api[_-]?key/i);
  });

  it('accepts parallel tool_call refs in one turn', async () => {
    const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
      (event) => event.type === 'done',
      (event) => (event as Extract<AssistantMessageEvent, { type: 'done' }>).message,
    );
    const builder = new AssistantStreamBuilder(stream, 'model', 'provider');
    builder.start();
    const toolA = createProviderOutputRef({
      protocol: 'fixture',
      providerBlockKey: 'tool:a',
      sourceIndex: 0,
      itemId: 'call_a',
      contentIndex: 0,
    });
    const toolB = createProviderOutputRef({
      protocol: 'fixture',
      providerBlockKey: 'tool:b',
      sourceIndex: 1,
      itemId: 'call_b',
      contentIndex: 1,
    });
    builder.startToolCall(toolA, 'call_a', 'read_file');
    builder.startToolCall(toolB, 'call_b', 'read_file');
    builder.appendToolCallArgs(toolA, '{"path":"a.md"}');
    builder.appendToolCallArgs(toolB, '{"path":"b.md"}');
    builder.endToolCall(toolA);
    builder.endToolCall(toolB);
    builder.done('toolUse');

    const message = await stream.result();
    const toolCalls = message.content.filter((block) => block.type === 'toolCall');
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls.map((block) => (block.type === 'toolCall' ? block.id : ''))).toEqual([
      'call_a',
      'call_b',
    ]);
  });

  it('keeps RequestPlan wire headers free of fixture secrets across adapters', () => {
    const secretPattern = /sk-fixture|fixture-api-key|fixture-goog-key|session=fixture/i;
    for (const spec of ADAPTER_FIXTURES) {
      const plan = buildPlan(spec);
      const safeHeaders = requestPlanHeaders(plan);
      expect(JSON.stringify(safeHeaders)).not.toMatch(secretPattern);
      expect(Object.keys(safeHeaders)).not.toEqual(
        expect.arrayContaining(['authorization', 'x-api-key', 'x-goog-api-key', 'cookie']),
      );
      const streamRaw = readFileSync(path.join(fixtureDir(spec), spec.streamFile), 'utf8');
      expect(streamRaw).not.toMatch(secretPattern);
    }
  });
});
