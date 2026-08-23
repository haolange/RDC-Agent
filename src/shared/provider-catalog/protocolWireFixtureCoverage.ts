import type { LlmProviderProtocol } from '../types/settings';
import type { ProviderAdapterId } from './implementationRegistry';

export interface ProtocolWireFixtureCoverage {
  dir: string;
  adapterId: ProviderAdapterId;
  transport: 'sse' | 'jsonl';
}

/**
 * Closed mapping from every native protocol to the wire fixture directory
 * that proves text + structured tool_call for its adapter.
 */
export const PROTOCOL_WIRE_FIXTURE_COVERAGE = {
  OpenAICompatibleChatCompletions: {
    dir: 'openai-compatible',
    adapterId: 'openai-compatible',
    transport: 'sse',
  },
  OpenAIResponses: {
    dir: 'openai-responses',
    adapterId: 'openai-responses',
    transport: 'sse',
  },
  AnthropicMessages: {
    dir: 'anthropic',
    adapterId: 'anthropic-messages',
    transport: 'sse',
  },
  OpenRouterChatCompletions: {
    dir: 'openrouter-chat',
    adapterId: 'openrouter-chat',
    transport: 'sse',
  },
  AzureOpenAIChatCompletions: {
    dir: 'azure-openai-chat',
    adapterId: 'azure-openai-chat',
    transport: 'sse',
  },
  AzureOpenAIResponses: {
    dir: 'azure-openai-responses',
    adapterId: 'azure-openai-responses',
    transport: 'sse',
  },
  GoogleInteractions: {
    dir: 'google-interactions',
    adapterId: 'google-interactions',
    transport: 'sse',
  },
  GoogleGemini: {
    dir: 'gemini',
    adapterId: 'google-gemini',
    transport: 'sse',
  },
  GoogleVertexGemini: {
    dir: 'google-vertex-gemini',
    adapterId: 'google-vertex-gemini',
    transport: 'sse',
  },
  GoogleVertexAnthropic: {
    dir: 'google-vertex-anthropic',
    adapterId: 'google-vertex-anthropic',
    transport: 'sse',
  },
  GitLabDuo: {
    dir: 'gitlab-duo',
    adapterId: 'gitlab-duo',
    transport: 'jsonl',
  },
  SapAiCoreOrchestration: {
    dir: 'sap-ai-core-orchestration',
    adapterId: 'sap-ai-core-orchestration',
    transport: 'jsonl',
  },
  SapAiCoreFoundationModels: {
    dir: 'sap-ai-core-foundation-models',
    adapterId: 'sap-ai-core-foundation-models',
    transport: 'jsonl',
  },
  OllamaOpenAICompatibleChatCompletions: {
    dir: 'ollama',
    adapterId: 'ollama-openai-compatible',
    transport: 'jsonl',
  },
  MistralConversations: {
    dir: 'mistral-conversations',
    adapterId: 'mistral-conversations',
    transport: 'sse',
  },
  BedrockConverseStream: {
    dir: 'bedrock-converse-stream',
    adapterId: 'bedrock-converse-stream',
    transport: 'sse',
  },
} as const satisfies Record<LlmProviderProtocol, ProtocolWireFixtureCoverage>;

export const PROTOCOL_WIRE_FIXTURE_DIRS = Object.freeze(
  [...new Set(Object.values(PROTOCOL_WIRE_FIXTURE_COVERAGE).map((entry) => entry.dir))],
);
