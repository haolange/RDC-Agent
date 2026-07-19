import { describe, expect, it } from 'vitest';
import { __testing as openAiWire } from './OpenAICompatibleProvider';
import { buildGeminiStreamUrl } from './GeminiProvider';
import { buildGoogleInteractionsUrl } from './GoogleInteractionsProvider';
import { buildAnthropicMessagesUrl } from './AnthropicProvider';
import { buildOpenAIResponsesUrl } from './OpenAIResponsesProvider';

describe('provider request URL contracts', () => {
  it('builds a versioned Azure chat URL without placing query before the operation path', () => {
    expect(openAiWire.buildChatCompletionsUrl(
      'https://sample.openai.azure.com/openai/deployments/gpt-5',
      { 'api-version': '2024-10-21' },
    )).toBe(
      'https://sample.openai.azure.com/openai/deployments/gpt-5/chat/completions?api-version=2024-10-21',
    );
  });

  it('builds chat endpoints exactly once for OpenAI-compatible routes', () => {
    expect(openAiWire.buildChatCompletionsUrl('https://api.example.test/v1/')).toBe(
      'https://api.example.test/v1/chat/completions',
    );
    expect(openAiWire.buildChatCompletionsUrl('https://api.example.test/v1/chat/completions')).toBe(
      'https://api.example.test/v1/chat/completions',
    );
  });

  it('builds every Merge Gateway operation exactly once', () => {
    expect(openAiWire.buildChatCompletionsUrl('https://api-gateway.merge.dev/v1/openai')).toBe(
      'https://api-gateway.merge.dev/v1/openai/chat/completions',
    );
    expect(buildOpenAIResponsesUrl('https://api-gateway.merge.dev/v1')).toBe(
      'https://api-gateway.merge.dev/v1/responses',
    );
    expect(buildAnthropicMessagesUrl(
      'https://api-gateway.merge.dev/v1/anthropic',
      'claude-sonnet-4-6',
    )).toBe('https://api-gateway.merge.dev/v1/anthropic/messages');
  });

  it('builds the GA Google Interactions operation exactly once', () => {
    expect(buildGoogleInteractionsUrl('https://generativelanguage.googleapis.com/v1/')).toBe(
      'https://generativelanguage.googleapis.com/v1/interactions',
    );
    expect(buildGoogleInteractionsUrl('https://generativelanguage.googleapis.com/v1/interactions')).toBe(
      'https://generativelanguage.googleapis.com/v1/interactions',
    );
  });

  it('builds the native Vertex Gemini publisher URL without an API-key query parameter', () => {
    expect(buildGeminiStreamUrl(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/sample/locations/us-central1/publishers/google',
      'gemini-2.5-pro',
      'oauth-token',
      'vertex',
    )).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/sample/locations/us-central1/publishers/google/models/gemini-2.5-pro:streamGenerateContent?alt=sse',
    );
  });

  it('builds the Vertex Anthropic partner streamRawPredict URL', () => {
    expect(buildAnthropicMessagesUrl(
      'https://us-east5-aiplatform.googleapis.com/v1/projects/sample/locations/us-east5/publishers/anthropic',
      'claude-sonnet-4-6@20260217',
      'vertex',
    )).toBe(
      'https://us-east5-aiplatform.googleapis.com/v1/projects/sample/locations/us-east5/publishers/anthropic/models/claude-sonnet-4-6%4020260217:streamRawPredict',
    );
  });

  it('appends the Anthropic operation exactly once to a provider-specific versioned base', () => {
    expect(buildAnthropicMessagesUrl(
      'https://api-gateway.merge.dev/v1/anthropic',
      'claude-sonnet-4-6',
    )).toBe('https://api-gateway.merge.dev/v1/anthropic/messages');
  });
});
