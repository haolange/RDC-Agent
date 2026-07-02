import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const {
  resolveAgentRouteCapability,
  resolveReasoningDelivery,
  reasoningDeliveryToStreamVisibility,
} = require('../src/main/agent-runtime/capabilities/RouteCapabilityResolver.ts');

const { createBuiltinProviderEntry } = require('../src/shared/constants/llm.ts');

const fail = (message) => {
  console.error(`[reasoning-delivery] ${message}`);
  process.exit(1);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

function configuredProvider(id, protocolOverride) {
  const provider = createBuiltinProviderEntry(id);
  return {
    ...provider,
    protocol: protocolOverride ?? provider.protocol,
    enabled: true,
    hasStoredSecret: true,
    isConfigured: true,
    status: 'verified',
    capabilities: [...(provider.capabilities ?? []), 'reasoning', 'chat', 'tool-calling'],
    models: [{
      id: 'test-model',
      label: 'test-model',
      enabled: true,
      contextWindowTokens: null,
    }],
  };
}

function resolveThinkingArtifact(reasoningDelivery, hasThinking) {
  if (!hasThinking || !reasoningDelivery || reasoningDelivery === 'none' || reasoningDelivery === 'hidden') {
    return undefined;
  }
  if (reasoningDelivery === 'summary-only') {
    return { kind: 'summary', visibility: 'summary', replayPolicy: 'none' };
  }
  return { kind: 'raw', visibility: 'raw-collapsed', replayPolicy: 'none' };
}
const anthropic = configuredProvider('anthropic', 'AnthropicMessages');
const openaiResponses = configuredProvider('openai', 'OpenAIResponses');
const gemini = configuredProvider('gemini-account', 'GoogleGemini');
const ollama = configuredProvider('ollama', 'OllamaOpenAICompatibleChatCompletions');

const anthropicCap = resolveAgentRouteCapability(anthropic, 'test-model');
assert(anthropicCap.reasoningDelivery === 'summary-only', 'Anthropic must use summary-only delivery');
assert(reasoningDeliveryToStreamVisibility(anthropicCap.reasoningDelivery) === 'summary-events', 'summary-only must map to summary-events stream visibility');
assert(resolveThinkingArtifact(anthropicCap.reasoningDelivery, true)?.kind === 'summary', 'summary-only thinking should become a visible summary artifact');

const responsesCap = resolveAgentRouteCapability(openaiResponses, 'test-model');
assert(responsesCap.reasoningDelivery === 'summary-only', 'OpenAI Responses must use summary-only delivery');

const geminiCap = resolveAgentRouteCapability(gemini, 'test-model');
assert(geminiCap.reasoningDelivery === 'stream-full', 'Gemini must use stream-full delivery');
assert(resolveThinkingArtifact(geminiCap.reasoningDelivery, true)?.visibility === 'raw-collapsed', 'stream-full thinking should become collapsed raw thinking');

const ollamaCap = resolveAgentRouteCapability(ollama, 'test-model');
assert(ollamaCap.reasoningDelivery === 'stream-full', 'Ollama must use stream-full delivery');
assert(resolveThinkingArtifact(ollamaCap.reasoningDelivery, true)?.replayPolicy === 'none', 'raw local thinking must not be replayed as provider artifact');

const noReasoningProvider = {
  ...configuredProvider('openai', 'OpenAICompatibleChatCompletions'),
  capabilities: ['chat', 'tool-calling'],
};
assert(resolveReasoningDelivery(noReasoningProvider, 'OpenAICompatibleChatCompletions') === 'none', 'providers without reasoning capability must be none');

const fs = require('node:fs');
const openaiCompatibleSource = fs.readFileSync('src/main/agent-runtime/providers/OpenAICompatibleProvider.ts', 'utf8');
const openaiResponsesSource = fs.readFileSync('src/main/agent-runtime/providers/OpenAIResponsesProvider.ts', 'utf8');
const anthropicSource = fs.readFileSync('src/main/agent-runtime/providers/AnthropicProvider.ts', 'utf8');
const contextManagerSource = fs.readFileSync('src/main/agent-runtime/agent/ContextManager.ts', 'utf8');

assert(openaiCompatibleSource.includes("source: isOpenRouterBaseUrl(baseUrl) ? 'openrouter-raw' : 'openai-compatible-raw'"), 'OpenAI-compatible raw reasoning must be tagged by source.');
assert(openaiCompatibleSource.includes("replayPolicy: 'none'"), 'OpenAI-compatible raw reasoning must not be replayed.');
assert(openaiResponsesSource.includes("'reasoning.encrypted_content'"), 'OpenAI Responses must request encrypted reasoning content for stateless continuation.');
assert(openaiResponsesSource.includes('toResponsesReasoningReplayItem'), 'OpenAI Responses must replay only provider reasoning artifacts.');
assert(anthropicSource.includes('signature_delta'), 'Anthropic provider must capture thinking signature deltas.');
assert(anthropicSource.includes('redacted_thinking'), 'Anthropic provider must preserve redacted thinking blocks.');
assert(anthropicSource.includes('toAnthropicThinkingReplayBlock'), 'Anthropic provider must replay provider thinking blocks as native blocks.');
assert(contextManagerSource.includes("block.replayPolicy === 'provider-artifact'"), 'Context budget must separate readable thinking from provider artifact replay.');

console.log('[reasoning-delivery] OK');
