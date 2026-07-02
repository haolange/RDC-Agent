import { describe, expect, it } from 'vitest';
import { __testing as anthropicTesting } from './AnthropicProvider';
import { __testing as geminiTesting } from './GeminiProvider';
import { __testing as ollamaTesting } from './OllamaProvider';
import { __testing as openAICompatibleTesting } from './OpenAICompatibleProvider';
import { __testing as openAIResponsesTesting } from './OpenAIResponsesProvider';
import type { AssistantMessage, Context, Model } from '../core/types';

const baseContext: Context = { messages: [] };
const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

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

describe('provider reasoning artifact replay policy', () => {
  it('does not replay raw Chat Completions thinking as ordinary assistant content', () => {
    const messages = openAICompatibleTesting.toOpenAIMessages({
      ...baseContext,
      messages: [assistant([
          {
            type: 'thinking',
            text: 'raw model thinking',
            kind: 'raw',
            source: 'openai-compatible-raw',
            visibility: 'raw-collapsed',
            replayPolicy: 'none',
          },
          { type: 'text', text: 'final answer' },
        ])],
    });

    expect(JSON.stringify(messages)).not.toContain('raw model thinking');
    expect(messages).toEqual([{ role: 'assistant', content: 'final answer' }]);
  });

  it('does not replay Gemini or Ollama raw thinking', () => {
    const assistantMessage = assistant([
      {
        type: 'thinking',
        text: 'raw local thinking',
        kind: 'raw',
        source: 'gemini-raw',
        visibility: 'raw-collapsed',
        replayPolicy: 'none',
      },
      { type: 'text', text: 'visible answer' },
    ]);
    expect(JSON.stringify(geminiTesting.toGeminiContents({ ...baseContext, messages: [assistantMessage] })))
      .not.toContain('raw local thinking');
    expect(JSON.stringify(ollamaTesting.toOllamaMessages({ ...baseContext, messages: [assistantMessage] })))
      .not.toContain('raw local thinking');
  });

  it('requests and replays OpenAI Responses encrypted reasoning artifacts only as provider items', () => {
    const requestBody = openAIResponsesTesting.buildRequestBody(
      { ...model('openai-responses'), id: 'o3', provider: 'openai' },
      baseContext,
      { reasoningVisibility: 'summary-events' },
    );
    expect(requestBody.reasoning).toMatchObject({ summary: 'auto' });
    expect(requestBody.include).toEqual(['reasoning.encrypted_content']);

    const input = openAIResponsesTesting.toResponsesInput({
      ...baseContext,
      messages: [assistant([
          {
            type: 'thinking',
            text: 'provider summary',
            kind: 'summary',
            source: 'openai-responses-summary',
            visibility: 'summary',
            replayPolicy: 'provider-artifact',
            artifact: {
              providerId: 'openai',
              modelId: 'o3',
              protocol: 'openai-responses',
              type: 'reasoning',
              id: 'rs_1',
              encryptedContent: 'encrypted',
            },
          },
          { type: 'text', text: 'answer' },
        ])],
    });

    expect(input).toContainEqual({ type: 'reasoning', id: 'rs_1', encrypted_content: 'encrypted' });
    expect(JSON.stringify(input)).not.toContain('provider summary');
  });

  it('replays Anthropic thinking and redacted thinking as native provider blocks', () => {
    const anthropicResult = anthropicTesting.toAnthropicMessages({
      ...baseContext,
      messages: [assistant([
          {
            type: 'thinking',
            text: 'signed thinking',
            kind: 'raw',
            source: 'anthropic-thinking',
            visibility: 'raw-collapsed',
            replayPolicy: 'provider-artifact',
            artifact: {
              providerId: 'anthropic',
              modelId: 'claude',
              protocol: 'anthropic-messages',
              type: 'thinking',
              signature: 'sig',
            },
          },
          {
            type: 'thinking',
            kind: 'opaque',
            source: 'anthropic-redacted-thinking',
            visibility: 'hidden',
            replayPolicy: 'provider-artifact',
            artifact: {
              providerId: 'anthropic',
              modelId: 'claude',
              protocol: 'anthropic-messages',
              type: 'redacted_thinking',
              data: 'redacted',
            },
          },
          { type: 'toolCall', id: 'tool_1', name: 'read_file', arguments: { path: 'README.md' } },
        ])],
    });

    expect(anthropicResult.messages[0].content).toContainEqual({ type: 'thinking', thinking: 'signed thinking', signature: 'sig' });
    expect(anthropicResult.messages[0].content).toContainEqual({ type: 'redacted_thinking', data: 'redacted' });
    expect(anthropicResult.messages[0].content).toContainEqual({
      type: 'tool_use',
      id: 'tool_1',
      name: 'read_file',
      input: { path: 'README.md' },
    });
  });
});
