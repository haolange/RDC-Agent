import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const {
  resolveAgentRouteCapability,
  resolveProviderReasoningContract,
  reasoningDeliveryToStreamVisibility,
} = require('../src/main/agent-runtime/capabilities/RouteCapabilityResolver.ts');

const {
  createProviderEntryFromCatalog,
  getLoadedProviderSurface,
  loadProviderSurface,
} = require('../src/main/provider-catalog/ProviderCatalogRegistry.ts');

await Promise.all([
  'anthropic',
  'openai',
  'google-ai-studio',
  'ollama',
  'deepseek',
  'kimi-coding-plan',
  'moonshot',
].map((id) => loadProviderSurface(id)));

const fail = (message) => {
  console.error(`[reasoning-delivery] ${message}`);
  throw new Error(message);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

function configuredProvider(id, protocolOverride) {
  const provider = createProviderEntryFromCatalog(id);
  return {
    ...provider,
    protocol: protocolOverride ?? provider.protocol,
    enabled: true,
    hasStoredSecret: true,
    isConfigured: true,
    status: 'verified',
    models: [{
      id: 'test-model',
      label: 'test-model',
      enabled: true,
      contextWindowTokens: null,
    }],
  };
}

function effectiveModel(provider, modelId, overrides = {}) {
  return {
    providerId: provider.id,
    modelId,
    label: modelId,
    aliases: [],
    enabled: true,
    route: {
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      contracts: getLoadedProviderSurface(provider.id)?.routes
        .find((route) => route.protocol === provider.protocol)?.contracts,
      source: 'catalog',
    },
    availability: 'available',
    contextTiers: [{ id: 'default', label: 'Default', activation: { kind: 'implicit' }, entitlement: 'granted' }],
    defaultBudgetTokens: 128000,
    controls: {
      fast: { state: 'unsupported', fixedValue: false },
      maxContext: { state: 'unsupported', fixedValue: false },
      reasoning: { kind: 'toggle', supportsOff: true, levels: [], defaultSelection: 'on', wireProfile: { kind: 'none' } },
    },
    toolCalling: { state: 'supported' },
    visionInput: { state: 'unknown' },
    structuredOutput: { state: 'unknown' },
    provenance: [],
    ...overrides,
  };
}

const anthropic = configuredProvider('anthropic', 'AnthropicMessages');
const openaiResponses = configuredProvider('openai', 'OpenAIResponses');
const gemini = configuredProvider('google-ai-studio', 'GoogleGemini');
const ollama = configuredProvider('ollama', 'OllamaOpenAICompatibleChatCompletions');
const deepseek = configuredProvider('deepseek', 'OpenAICompatibleChatCompletions');
const kimi = configuredProvider('kimi-coding-plan', 'AnthropicMessages');

const anthropicCap = resolveAgentRouteCapability(anthropic, 'test-model', effectiveModel(anthropic, 'test-model'));
assert(anthropicCap.reasoningDelivery === 'summary-only', 'Anthropic must use summary-only delivery');
assert(anthropicCap.reasoningContract.semantic === 'summary', 'Native Anthropic summarized display must be explicit');
assert(reasoningDeliveryToStreamVisibility(anthropicCap.reasoningDelivery) === 'summary-events', 'summary-only must map to summary-events stream visibility');

const responsesCap = resolveAgentRouteCapability(openaiResponses, 'test-model', effectiveModel(openaiResponses, 'test-model'));
assert(responsesCap.reasoningDelivery === 'summary-only', 'OpenAI Responses must use summary-only delivery');
assert(responsesCap.reasoningContract.semantic === 'summary', 'Native OpenAI Responses summary events must be explicit');

const geminiCap = resolveAgentRouteCapability(gemini, 'test-model', effectiveModel(gemini, 'test-model'));
assert(geminiCap.reasoningDelivery === 'stream-full', 'Gemini must use stream-full delivery');
assert(geminiCap.reasoningContract.semantic === 'unknown', 'Gemini display semantics must remain unknown without model-specific evidence');

const ollamaCap = resolveAgentRouteCapability(ollama, 'test-model', effectiveModel(ollama, 'test-model'));
assert(ollamaCap.reasoningDelivery === 'stream-full', 'Ollama must use stream-full delivery');
assert(
  ollamaCap.reasoningContract.semantic === 'raw'
    && ollamaCap.reasoningContract.source === 'provider-docs:ollama-thinking'
    && Boolean(ollamaCap.reasoningContract.evidence)
    && ollamaCap.reasoningContract.visibilityRequest === 'ollama-think',
  'Ollama reasoning must be the manifest-declared, documented raw contract with the think request, never inferred',
);

assert(resolveAgentRouteCapability(deepseek, 'deepseek-reasoner', effectiveModel(deepseek, 'deepseek-reasoner')).reasoningContract.semantic === 'raw', 'Direct DeepSeek reasoning_content is documented raw reasoning');
assert(resolveAgentRouteCapability(kimi, 'kimi-for-coding', effectiveModel(kimi, 'kimi-for-coding')).reasoningContract.semantic === 'raw', 'Kimi Coding Plan must be raw, never Anthropic summary');
const moonshotAnthropic = configuredProvider('moonshot', 'AnthropicMessages');
assert(resolveAgentRouteCapability(moonshotAnthropic, 'kimi-k2.5', effectiveModel(moonshotAnthropic, 'kimi-k2.5')).reasoningContract.semantic === 'raw', 'Moonshot compatible Anthropic must be raw');
const deepseekAnthropic = configuredProvider('deepseek', 'AnthropicMessages');
assert(resolveAgentRouteCapability(deepseekAnthropic, 'deepseek-flash', effectiveModel(deepseekAnthropic, 'deepseek-flash')).reasoningContract.semantic === 'raw', 'DeepSeek Anthropic route must stay raw');

const noReasoningProvider = configuredProvider('openai', 'OpenAICompatibleChatCompletions');
assert(resolveProviderReasoningContract(noReasoningProvider, effectiveModel(noReasoningProvider, 'test-model', {
  controls: {
    fast: { state: 'unsupported', fixedValue: false },
    maxContext: { state: 'unsupported', fixedValue: false },
    reasoning: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
  },
})).semantic === 'none', 'models without reasoning capability must be none');

const fs = require('node:fs');

// Continuation 持久化回放契约（D1/D2）：
// 1) journal 落盘不得升格为可读 thinking（text 永远剥离）；
// 2) 跨身份必经 ReplayPolicy 决策（drop / replay）；
// 3) retention 上限必须生效。
const journalSource = fs.readFileSync('src/main/conversation/SessionContextJournal.ts', 'utf8');
assert(!journalSource.includes('sanitizeReadableContinuation'), 'Legacy readable-only continuation persistence must remain removed.');
assert(/CONTINUATION_RETENTION_TURNS\s*=\s*\d+/.test(journalSource), 'Journal must define a bounded CONTINUATION_RETENTION_TURNS constant.');

const resolverSource = fs.readFileSync('src/main/agent-runtime/capabilities/RouteCapabilityResolver.ts', 'utf8');
const traceServiceSource = fs.readFileSync('src/main/agent-trace/TraceService.ts', 'utf8');
const traceEmitterSource = fs.readFileSync('src/main/agent-trace/TraceEventEmitter.ts', 'utf8');
const conversationServiceSource = fs.readFileSync('src/main/conversation/ConversationService.ts', 'utf8');
const conversationTurnRunnerSource = fs.readFileSync('src/main/conversation/ConversationTurnRunner.ts', 'utf8');
const conversationCanonicalSources = `${conversationServiceSource}\n${conversationTurnRunnerSource}`;
const kimiSurface = getLoadedProviderSurface('kimi-coding-plan');

assert(kimiSurface?.routes.length === 2, 'Kimi must retain both declared protocol routes.');
assert(kimiSurface?.routes.every((route) => route.contracts.reasoning.semantic === 'raw'), 'Every Kimi protocol route must explicitly declare raw reasoning.');
assert(!resolverSource.includes('RAW_REASONING_PROVIDER_IDS'), 'Reasoning resolver must not restore provider-id raw lists.');
assert(!resolverSource.includes('api-docs.deepseek.com'), 'Reasoning evidence URLs belong to strict manifests, not TypeScript.');
assert(!traceServiceSource.includes('emitThoughtFromText'), 'Conversation text must never be synthesized into trace thinking.');
assert(!traceEmitterSource.includes("event.type === 'assistant.completed'"), 'assistant.completed text must not create thought nodes.');
assert(!traceEmitterSource.includes("event.type === 'message_end'"), 'core message_end text must not create thought nodes.');
assert(!traceEmitterSource.includes('synthesizeFromConversation'), 'Conversation-wide thought synthesis must remain removed.');
assert(!/event\.type === 'tool\.started'[\s\S]{0,240}beginAssistantContentLoop\(\)/u.test(conversationCanonicalSources), 'Tool lifecycle events must not consume the pending assistant loop transition.');
assert(!conversationCanonicalSources.includes('currentLoopText.trim() || rawResponse || visibleResponse'), 'Conversation terminal content must not fall back to loop text.');
assert(!conversationCanonicalSources.includes('rawResponse ||'), 'Conversation terminal content must not restore raw provider text fallback.');

const unknownProvider = configuredProvider('custom-endpoint', 'OpenAICompatibleChatCompletions');
assert(resolveProviderReasoningContract(unknownProvider, effectiveModel(unknownProvider, 'unknown-model')).semantic === 'unknown', 'Undeclared third-party routes must remain unknown.');

console.log('[reasoning-delivery] OK');
