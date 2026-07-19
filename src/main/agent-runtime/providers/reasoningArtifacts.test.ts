import { describe, expect, it } from 'vitest';
import type { ReasoningControl } from '@shared/types/modelCapability';
import type {
  ProviderContractBundle,
  ProviderReasoningContract,
  ProviderToolLoopContract,
} from '@shared/provider-catalog/modelManifestSchema';
import { createFailClosedProviderContracts } from '@shared/provider-catalog/providerContracts';
import type { RequestPlan } from '@shared/types/providerCapability';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import { createContinuationArtifact } from '../reasoning/ContinuationArtifacts';
import { __testing as anthropicTesting } from './AnthropicProvider';
import { __testing as geminiTesting } from './GeminiProvider';
import { __testing as ollamaTesting } from './OllamaProvider';
import { __testing as openAICompatibleTesting } from './OpenAICompatibleProvider';
import { __testing as openAIResponsesTesting } from './OpenAIResponsesProvider';
import type { AssistantMessage, Context, Model } from '../core/types';

const baseContext: Context = { messages: [] };
const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
const openAiLevels = {
  kind: 'levels',
  supportsOff: true,
  levels: ['low', 'medium', 'high', 'xhigh'],
  defaultSelection: 'medium',
  wireProfile: {
    kind: 'openai-responses',
    on: 'medium',
    levels: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
  },
} satisfies ReasoningControl;

type PlanInput = {
  providerId: string;
  adapterId: RequestPlan['adapterId'];
  protocol: RequestPlan['route']['protocol'];
  modelId: string;
  reasoning: Pick<
    ProviderReasoningContract,
    'semantic' | 'displayLabel' | 'carrier' | 'artifactFormat' | 'artifactVersion' | 'compatibilityGroup' | 'continuation'
  >;
  toolLoop: Pick<ProviderToolLoopContract, 'artifactPolicy' | 'artifactScope' | 'ordering'>;
};

function createPlan(input: PlanInput): RequestPlan {
  const fallback = createFailClosedProviderContracts(input.protocol);
  const contracts: ProviderContractBundle = {
    ...fallback,
    protocolDialect: input.protocol,
    protocolVersion: 'test-v1',
    compatibilityGroup: input.reasoning.compatibilityGroup,
    reasoning: {
      ...input.reasoning,
      source: 'test-contract',
    },
    toolLoop: {
      ...input.toolLoop,
      modelSwitch: 'pin-until-terminal',
    },
  };
  return createTestRequestPlan({
    providerId: input.providerId,
    adapterId: input.adapterId,
    catalogRevision: 'test-catalog',
    routeRevision: 'test-route',
    selectedModelId: input.modelId,
    effectiveModelId: input.modelId,
    appliedBindingIds: [],
    route: {
      protocol: input.protocol,
      baseUrl: 'https://example.test',
      source: 'catalog',
      contracts,
    },
    contracts,
    headers: {},
    bodyPatch: {},
    contextBudgetTokens: 128_000,
    contextMode: 'normal',
    contextWindowTokens: 128_000,
    activeTierId: 'default',
    fastMode: false,
    reasoningWire: { selection: 'off', control: openAiLevels },
  });
}

const statelessChatPlan = createPlan({
  providerId: 'compatible',
  adapterId: 'openai-compatible',
  protocol: 'OpenAICompatibleChatCompletions',
  modelId: 'chat-model',
  reasoning: {
    semantic: 'unknown',
    displayLabel: 'Provider reasoning',
    carrier: 'unknown',
    artifactFormat: 'unknown',
    artifactVersion: 'unknown',
    compatibilityGroup: 'none',
    continuation: 'unknown',
  },
  toolLoop: { artifactPolicy: 'discard', artifactScope: 'none', ordering: 'assistant-tool-result' },
});

const responsesPlan = createPlan({
  providerId: 'openai',
  adapterId: 'openai-responses',
  protocol: 'OpenAIResponses',
  modelId: 'gpt-5.5',
  reasoning: {
    semantic: 'summary',
    displayLabel: 'Reasoning summary',
    carrier: 'reasoning-item',
    artifactFormat: 'openai-responses-reasoning',
    artifactVersion: 'v1',
    compatibilityGroup: 'openai-responses-v1',
    continuation: 'exact-execution',
  },
  toolLoop: { artifactPolicy: 'preserve-exact', artifactScope: 'all-assistant-turns', ordering: 'provider-native' },
});

const anthropicPlan = createPlan({
  providerId: 'anthropic',
  adapterId: 'anthropic-messages',
  protocol: 'AnthropicMessages',
  modelId: 'claude',
  reasoning: {
    semantic: 'raw',
    displayLabel: 'Raw reasoning',
    carrier: 'signed-content-block',
    artifactFormat: 'anthropic-thinking-block',
    artifactVersion: 'v1',
    compatibilityGroup: 'anthropic-messages-v1',
    continuation: 'exact-execution',
  },
  toolLoop: { artifactPolicy: 'preserve-exact', artifactScope: 'tool-call-turn', ordering: 'strict-block-order' },
});

const geminiPlan = createPlan({
  providerId: 'google',
  adapterId: 'google-gemini',
  protocol: 'GoogleGemini',
  modelId: 'gemini',
  reasoning: {
    semantic: 'raw',
    displayLabel: 'Raw reasoning',
    carrier: 'thought-signature',
    artifactFormat: 'gemini-thought-signature',
    artifactVersion: 'v1',
    compatibilityGroup: 'gemini-generate-content-v1',
    continuation: 'exact-execution',
  },
  toolLoop: { artifactPolicy: 'preserve-thought-signature', artifactScope: 'tool-call-turn', ordering: 'provider-native' },
});

const reasoningContentPlan = createPlan({
  providerId: 'deepseek',
  adapterId: 'openai-compatible',
  protocol: 'OpenAICompatibleChatCompletions',
  modelId: 'deepseek-reasoner',
  reasoning: {
    semantic: 'raw',
    displayLabel: 'Raw reasoning',
    carrier: 'reasoning-content',
    artifactFormat: 'reasoning-content',
    artifactVersion: 'v1',
    compatibilityGroup: 'deepseek-reasoning-v1',
    continuation: 'same-provider-model',
  },
  toolLoop: {
    artifactPolicy: 'preserve-reasoning-content',
    artifactScope: 'all-assistant-turns',
    ordering: 'assistant-tool-result',
  },
});

const model = (api: Model['api']): Model => ({
  id: 'test-model',
  name: 'test-model',
  provider: 'test-provider',
  api,
  contextWindow: 128000,
  maxTokens: 4096,
  reasoning: true,
  vision: true,
});

const assistant = (content: AssistantMessage['content']): AssistantMessage => ({
  role: 'assistant',
  content,
  model: 'test-model',
  provider: 'test-provider',
  usage,
  stopReason: 'stop',
  timestamp: 1,
});

describe('provider continuation artifact delivery', () => {
  it('preserves Claude Account identity betas when a context tier adds another beta', () => {
    expect(anthropicTesting.mergeAnthropicRequestHeaders(
      {
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
        'User-Agent': 'claude-cli/2.1.119 (external, cli)',
      },
      { 'Anthropic-Beta': 'context-1m-2025-08-07,oauth-2025-04-20' },
    )).toEqual({
      'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,context-1m-2025-08-07',
      'User-Agent': 'claude-cli/2.1.119 (external, cli)',
    });
  });

  it('maps Off and named reasoning controls to OpenAI Responses payloads', () => {
    const offResponsesBody = openAIResponsesTesting.buildRequestBody(
      { ...model('openai-responses'), id: 'gpt-5.5', provider: 'openai' },
      baseContext,
      { requestPlan: responsesPlan, reasoning: { selection: 'off', control: openAiLevels }, reasoningVisibility: 'summary-events' },
    );
    expect(offResponsesBody.reasoning).toBeUndefined();
    expect(offResponsesBody.include).toBeUndefined();

    const levelResponsesBody = openAIResponsesTesting.buildRequestBody(
      { ...model('openai-responses'), id: 'gpt-5.5', provider: 'openai' },
      baseContext,
      { requestPlan: responsesPlan, reasoning: { selection: 'xhigh', control: openAiLevels }, reasoningVisibility: 'summary-events' },
    );
    expect(levelResponsesBody.reasoning).toMatchObject({ effort: 'xhigh', summary: 'auto' });
    expect(levelResponsesBody.include).toEqual(['reasoning.encrypted_content']);
  });

  it('never promotes raw Chat Completions thinking to ordinary assistant text', () => {
    const messages = openAICompatibleTesting.toOpenAIMessages({
      ...baseContext,
      messages: [assistant([
        {
          type: 'thinking',
          text: 'raw model thinking',
          kind: 'raw',
          source: 'openai-compatible-raw',
          visibility: 'raw-collapsed',
        },
        { type: 'text', text: 'final answer' },
      ])],
    }, statelessChatPlan);

    expect(JSON.stringify(messages)).not.toContain('raw model thinking');
    expect(messages).toEqual([{ role: 'assistant', content: 'final answer' }]);
  });

  it('does not replay unsigned Gemini or Ollama raw thinking', () => {
    const assistantMessage = assistant([
      {
        type: 'thinking',
        text: 'raw local thinking',
        kind: 'raw',
        source: 'gemini-summary',
        visibility: 'raw-collapsed',
      },
      { type: 'text', text: 'visible answer' },
    ]);
    expect(JSON.stringify(geminiTesting.toGeminiContents(
      { ...baseContext, messages: [assistantMessage] },
      geminiPlan,
    ))).not.toContain('raw local thinking');
    expect(JSON.stringify(ollamaTesting.toOllamaMessages({ ...baseContext, messages: [assistantMessage] })))
      .not.toContain('raw local thinking');
  });

  it('replays OpenAI Responses encrypted reasoning only as a provider item', () => {
    const continuation = createContinuationArtifact(responsesPlan, {
      type: 'reasoning',
      id: 'rs_1',
      encryptedContent: 'encrypted',
    });
    expect(continuation).toBeDefined();

    const input = openAIResponsesTesting.toResponsesInput({
      ...baseContext,
      messages: [assistant([
        {
          type: 'thinking',
          text: 'provider summary',
          kind: 'summary',
          source: 'openai-responses-summary',
          visibility: 'summary',
          continuation,
        },
        { type: 'text', text: 'answer' },
      ])],
    }, responsesPlan);

    expect(input).toContainEqual({ type: 'reasoning', id: 'rs_1', encrypted_content: 'encrypted' });
    expect(JSON.stringify(input)).not.toContain('provider summary');
  });

  it('replays Anthropic signed and redacted blocks verbatim inside the pinned tool loop', () => {
    const signed = createContinuationArtifact(anthropicPlan, { type: 'thinking', signature: 'sig' });
    const redacted = createContinuationArtifact(anthropicPlan, {
      type: 'redacted_thinking',
      redactedContent: 'redacted',
    });
    const result = anthropicTesting.toAnthropicMessages({
      ...baseContext,
      messages: [assistant([
        {
          type: 'thinking',
          text: 'signed thinking',
          kind: 'raw',
          source: 'anthropic-thinking',
          visibility: 'raw-collapsed',
          continuation: signed,
        },
        {
          type: 'thinking',
          kind: 'opaque',
          source: 'anthropic-redacted-thinking',
          visibility: 'hidden',
          continuation: redacted,
        },
        { type: 'toolCall', id: 'tool_1', name: 'read_file', arguments: { path: 'README.md' } },
      ])],
    }, anthropicPlan);

    expect(result.messages[0].content).toContainEqual({
      type: 'thinking',
      thinking: 'signed thinking',
      signature: 'sig',
    });
    expect(result.messages[0].content).toContainEqual({ type: 'redacted_thinking', data: 'redacted' });
  });

  it('reattaches Gemini thoughtSignature to its bound function call', () => {
    const continuation = createContinuationArtifact(geminiPlan, {
      type: 'thought_signature',
      thoughtSignature: 'gemini-signature',
      containerBinding: {
        providerBlockKey: 'candidate:0:part:0',
        toolCallIds: ['tool_1'],
      },
    });
    const result = geminiTesting.toGeminiContents({
      ...baseContext,
      messages: [assistant([
        {
          type: 'thinking',
          kind: 'opaque',
          source: 'gemini-thought-signature',
          visibility: 'hidden',
          continuation,
        },
        { type: 'toolCall', id: 'tool_1', name: 'read_file', arguments: { path: 'README.md' } },
      ])],
    }, geminiPlan);

    expect(result.contents[0].parts).toContainEqual({
      functionCall: { name: 'read_file', args: { path: 'README.md' } },
      thoughtSignature: 'gemini-signature',
    });
  });

  it('replays reasoning_content only for an explicitly compatible provider/model contract', () => {
    const continuation = createContinuationArtifact(reasoningContentPlan, {
      type: 'reasoning_content',
      reasoningContent: 'required tool-loop reasoning',
    });
    const result = openAICompatibleTesting.toOpenAIMessages({
      ...baseContext,
      messages: [assistant([
        {
          type: 'thinking',
          kind: 'raw',
          source: 'deepseek-raw',
          visibility: 'raw-collapsed',
          continuation,
        },
        { type: 'toolCall', id: 'tool_1', name: 'read_file', arguments: {} },
      ])],
    }, reasoningContentPlan);

    expect(result[0]).toMatchObject({
      role: 'assistant',
      reasoning_content: 'required tool-loop reasoning',
    });
  });

  it('groups consecutive Anthropic tool results into the immediate next user message', () => {
    const result = anthropicTesting.toAnthropicMessages({
      ...baseContext,
      messages: [
        assistant([
          { type: 'toolCall', id: 'tool_1', name: 'memory_read', arguments: { name: 'project-identity' } },
          { type: 'toolCall', id: 'tool_2', name: 'memory_read', arguments: { name: 'project-model' } },
        ]),
        {
          role: 'toolResult',
          toolCallId: 'tool_1',
          toolName: 'memory_read',
          content: [{ type: 'text', text: 'identity' }],
          isError: false,
          timestamp: 1,
        },
        {
          role: 'toolResult',
          toolCallId: 'tool_2',
          toolName: 'memory_read',
          content: [{ type: 'text', text: 'model' }],
          isError: false,
          timestamp: 1,
        },
      ],
    }, anthropicPlan);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toMatchObject({ role: 'user' });
    expect(result.messages[1].content).toMatchObject([
      { type: 'tool_result', tool_use_id: 'tool_1' },
      { type: 'tool_result', tool_use_id: 'tool_2' },
    ]);
  });

  it('does not send empty Anthropic message content', () => {
    const result = anthropicTesting.toAnthropicMessages({
      ...baseContext,
      messages: [
        assistant([]),
        {
          role: 'toolResult',
          toolCallId: 'tool_empty',
          toolName: 'memory_read',
          content: [],
          isError: false,
          timestamp: 1,
        },
      ],
    }, anthropicPlan);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toMatchObject([
      {
        type: 'tool_result',
        tool_use_id: 'tool_empty',
        content: [{ type: 'text', text: 'Tool returned no text.' }],
      },
    ]);
  });
});
