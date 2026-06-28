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

function resolveThinkingPresentation(reasoningDelivery, hasThinking) {
  if (!hasThinking || !reasoningDelivery || reasoningDelivery === 'none' || reasoningDelivery === 'hidden') {
    return 'none';
  }
  if (reasoningDelivery === 'summary-only') return 'summary';
  return 'full';
}

const anthropic = configuredProvider('anthropic', 'AnthropicMessages');
const openaiResponses = configuredProvider('openai', 'OpenAIResponses');
const gemini = configuredProvider('gemini-account', 'GoogleGemini');
const ollama = configuredProvider('ollama', 'OllamaOpenAICompatibleChatCompletions');

const anthropicCap = resolveAgentRouteCapability(anthropic, 'test-model');
assert(anthropicCap.reasoningDelivery === 'summary-only', 'Anthropic must use summary-only delivery');
assert(reasoningDeliveryToStreamVisibility(anthropicCap.reasoningDelivery) === 'summary-events', 'summary-only must map to summary-events stream visibility');
assert(resolveThinkingPresentation(anthropicCap.reasoningDelivery, true) === 'summary', 'summary-only thinking should clamp in UI');

const responsesCap = resolveAgentRouteCapability(openaiResponses, 'test-model');
assert(responsesCap.reasoningDelivery === 'summary-only', 'OpenAI Responses must use summary-only delivery');

const geminiCap = resolveAgentRouteCapability(gemini, 'test-model');
assert(geminiCap.reasoningDelivery === 'stream-full', 'Gemini must use stream-full delivery');
assert(resolveThinkingPresentation(geminiCap.reasoningDelivery, true) === 'full', 'stream-full thinking should not clamp in UI');

const ollamaCap = resolveAgentRouteCapability(ollama, 'test-model');
assert(ollamaCap.reasoningDelivery === 'stream-full', 'Ollama must use stream-full delivery');

const noReasoningProvider = {
  ...configuredProvider('openai', 'OpenAICompatibleChatCompletions'),
  capabilities: ['chat', 'tool-calling'],
};
assert(resolveReasoningDelivery(noReasoningProvider, 'OpenAICompatibleChatCompletions') === 'none', 'providers without reasoning capability must be none');

console.log('[reasoning-delivery] OK');
