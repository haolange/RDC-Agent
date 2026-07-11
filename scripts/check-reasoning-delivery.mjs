import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const {
  resolveAgentRouteCapability,
  resolveProviderReasoningContract,
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

const anthropic = configuredProvider('anthropic', 'AnthropicMessages');
const openaiResponses = configuredProvider('openai', 'OpenAIResponses');
const gemini = configuredProvider('gemini-account', 'GoogleGemini');
const ollama = configuredProvider('ollama', 'OllamaOpenAICompatibleChatCompletions');
const deepseek = configuredProvider('deepseek', 'OpenAICompatibleChatCompletions');
const kimi = configuredProvider('kimi-coding-plan', 'AnthropicMessages');

const anthropicCap = resolveAgentRouteCapability(anthropic, 'test-model');
assert(anthropicCap.reasoningDelivery === 'summary-only', 'Anthropic must use summary-only delivery');
assert(anthropicCap.reasoningContract.semantic === 'summary', 'Native Anthropic summarized display must be explicit');
assert(reasoningDeliveryToStreamVisibility(anthropicCap.reasoningDelivery) === 'summary-events', 'summary-only must map to summary-events stream visibility');

const responsesCap = resolveAgentRouteCapability(openaiResponses, 'test-model');
assert(responsesCap.reasoningDelivery === 'summary-only', 'OpenAI Responses must use summary-only delivery');
assert(responsesCap.reasoningContract.semantic === 'summary', 'Native OpenAI Responses summary events must be explicit');

const geminiCap = resolveAgentRouteCapability(gemini, 'test-model');
assert(geminiCap.reasoningDelivery === 'stream-full', 'Gemini must use stream-full delivery');
assert(geminiCap.reasoningContract.semantic === 'unknown', 'Gemini display semantics must remain unknown without model-specific evidence');

const ollamaCap = resolveAgentRouteCapability(ollama, 'test-model');
assert(ollamaCap.reasoningDelivery === 'stream-full', 'Ollama must use stream-full delivery');
assert(ollamaCap.reasoningContract.semantic === 'unknown', 'Ollama-compatible reasoning must not be inferred as raw');

assert(resolveAgentRouteCapability(deepseek, 'deepseek-reasoner').reasoningContract.semantic === 'raw', 'Direct DeepSeek reasoning_content is documented raw reasoning');
assert(resolveAgentRouteCapability(kimi, 'kimi-for-coding').reasoningContract.semantic === 'raw', 'Kimi Coding Plan must be raw, never Anthropic summary');
assert(resolveAgentRouteCapability(configuredProvider('moonshot', 'AnthropicMessages'), 'kimi-k2.5').reasoningContract.semantic === 'raw', 'Moonshot compatible Anthropic must be raw');
assert(resolveAgentRouteCapability(configuredProvider('deepseek', 'AnthropicMessages'), 'deepseek-v4-pro').reasoningContract.semantic === 'raw', 'DeepSeek Anthropic route must stay raw');

const noReasoningProvider = {
  ...configuredProvider('openai', 'OpenAICompatibleChatCompletions'),
  capabilities: ['chat', 'tool-calling'],
};
assert(resolveProviderReasoningContract(noReasoningProvider, 'test-model').semantic === 'none', 'providers without reasoning capability must be none');

const fs = require('node:fs');
const openaiCompatibleSource = fs.readFileSync('src/main/agent-runtime/providers/OpenAICompatibleProvider.ts', 'utf8');
const openaiResponsesSource = fs.readFileSync('src/main/agent-runtime/providers/OpenAIResponsesProvider.ts', 'utf8');
const anthropicSource = fs.readFileSync('src/main/agent-runtime/providers/AnthropicProvider.ts', 'utf8');
const contextManagerSource = fs.readFileSync('src/main/agent-runtime/agent/ContextManager.ts', 'utf8');

assert(openaiCompatibleSource.includes("replayPolicy: 'openai-reasoning-content'"), 'OpenAI-compatible thinking must mark openai-reasoning-content replay.');
assert(openaiCompatibleSource.includes('out.reasoning_content = reasoning.join'), 'OpenAI-compatible tool loops must replay reasoning_content.');
assert(openaiResponsesSource.includes("'reasoning.encrypted_content'"), 'OpenAI Responses must request encrypted reasoning content for stateless continuation.');
assert(openaiResponsesSource.includes('toResponsesReasoningReplayItem'), 'OpenAI Responses must replay only provider reasoning artifacts.');
assert(anthropicSource.includes('signature_delta'), 'Anthropic provider must capture thinking signature deltas.');
assert(anthropicSource.includes('redacted_thinking'), 'Anthropic provider must preserve redacted thinking blocks.');
assert(anthropicSource.includes('toAnthropicThinkingReplayBlock'), 'Anthropic provider must replay provider thinking blocks as native blocks.');
assert(contextManagerSource.includes("block.replayPolicy === 'provider-artifact'"), 'Context budget must separate readable thinking from provider artifact replay.');

console.log('[reasoning-delivery] OK');
