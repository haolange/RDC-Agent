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
  process.exit(1);
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
assert(ollamaCap.reasoningContract.semantic === 'unknown', 'Ollama-compatible reasoning must not be inferred as raw');

assert(resolveAgentRouteCapability(deepseek, 'deepseek-reasoner', effectiveModel(deepseek, 'deepseek-reasoner')).reasoningContract.semantic === 'raw', 'Direct DeepSeek reasoning_content is documented raw reasoning');
assert(resolveAgentRouteCapability(kimi, 'kimi-for-coding', effectiveModel(kimi, 'kimi-for-coding')).reasoningContract.semantic === 'raw', 'Kimi Coding Plan must be raw, never Anthropic summary');
const moonshotAnthropic = configuredProvider('moonshot', 'AnthropicMessages');
assert(resolveAgentRouteCapability(moonshotAnthropic, 'kimi-k2.5', effectiveModel(moonshotAnthropic, 'kimi-k2.5')).reasoningContract.semantic === 'raw', 'Moonshot compatible Anthropic must be raw');
const deepseekAnthropic = configuredProvider('deepseek', 'AnthropicMessages');
assert(resolveAgentRouteCapability(deepseekAnthropic, 'deepseek-v4-pro', effectiveModel(deepseekAnthropic, 'deepseek-v4-pro')).reasoningContract.semantic === 'raw', 'DeepSeek Anthropic route must stay raw');

const noReasoningProvider = configuredProvider('openai', 'OpenAICompatibleChatCompletions');
assert(resolveProviderReasoningContract(noReasoningProvider, effectiveModel(noReasoningProvider, 'test-model', {
  controls: {
    fast: { state: 'unsupported', fixedValue: false },
    maxContext: { state: 'unsupported', fixedValue: false },
    reasoning: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
  },
})).semantic === 'none', 'models without reasoning capability must be none');

const fs = require('node:fs');
const openaiCompatibleSource = fs.readFileSync('src/main/agent-runtime/providers/OpenAICompatibleProvider.ts', 'utf8');
const openaiResponsesSource = fs.readFileSync('src/main/agent-runtime/providers/OpenAIResponsesProvider.ts', 'utf8');
const anthropicSource = fs.readFileSync('src/main/agent-runtime/providers/AnthropicProvider.ts', 'utf8');
const contextManagerSource = fs.readFileSync('src/main/agent-runtime/agent/ContextManager.ts', 'utf8');

assert(openaiCompatibleSource.includes('createContinuationArtifact'), 'OpenAI-compatible thinking must build a contract-bound continuation artifact.');
assert(openaiCompatibleSource.includes('out.reasoning_content = reasoning.join'), 'OpenAI-compatible tool loops must replay reasoning_content.');
assert(openaiResponsesSource.includes("'reasoning.encrypted_content'"), 'OpenAI Responses must request encrypted reasoning content for stateless continuation.');
assert(openaiResponsesSource.includes('toResponsesReasoningReplayItem'), 'OpenAI Responses must replay only provider reasoning artifacts.');
assert(anthropicSource.includes('signature_delta'), 'Anthropic provider must capture thinking signature deltas.');
assert(anthropicSource.includes('responseId = evt.message.id'), 'Anthropic provider source refs must retain message_start response ids.');
assert(anthropicSource.includes('redacted_thinking'), 'Anthropic provider must preserve redacted thinking blocks.');
assert(anthropicSource.includes('toAnthropicThinkingReplayBlock'), 'Anthropic provider must replay provider thinking blocks as native blocks.');
assert(contextManagerSource.includes('block.continuation') && contextManagerSource.includes('providerArtifactChars'), 'Context budget must count opaque continuation payloads without promoting them to readable thinking.');

// Continuation 持久化回放契约（D1/D2）：
// 1) journal 落盘不得升格为可读 thinking（text 永远剥离）；
// 2) 跨身份必经 ReplayPolicy 决策（drop / replay）；
// 3) retention 上限必须生效。
const journalSource = fs.readFileSync('src/main/conversation/SessionContextJournal.ts', 'utf8');
const replayPolicySource = fs.readFileSync('src/main/agent-runtime/reasoning/ContinuationReplayPolicy.ts', 'utf8');
assert(journalSource.includes('text: undefined'), 'Journal persistence must strip readable thinking text; artifacts must never be promoted to display copy.');
assert(journalSource.includes('sanitizeContinuationForJournal'), 'Journal persistence must go through the cross-turn-scope continuation sanitizer.');
assert(!journalSource.includes('sanitizeReadableContinuation'), 'Legacy readable-only continuation persistence must remain removed.');
assert(journalSource.includes('decideContinuationReplay'), 'Journal materialization must route every artifact through ContinuationReplayPolicy.');
assert(/CONTINUATION_RETENTION_TURNS\s*=\s*\d+/.test(journalSource), 'Journal must define a bounded CONTINUATION_RETENTION_TURNS constant.');
assert(journalSource.includes("'retention-expired'"), 'Artifacts older than the retention window must drop with a retention-expired decision.');
assert(replayPolicySource.includes("'retention-expired'"), 'ContinuationReplayReason must include retention-expired.');


const resolverSource = fs.readFileSync('src/main/agent-runtime/capabilities/RouteCapabilityResolver.ts', 'utf8');
const builderSource = fs.readFileSync('src/main/agent-runtime/providers/internal/AssistantStreamBuilder.ts', 'utf8');
const traceServiceSource = fs.readFileSync('src/main/agent-trace/TraceService.ts', 'utf8');
const traceEmitterSource = fs.readFileSync('src/main/agent-trace/TraceEventEmitter.ts', 'utf8');
const canonicalOutputSource = fs.readFileSync('src/main/conversation/CanonicalAssistantOutput.ts', 'utf8');
const conversationServiceSource = fs.readFileSync('src/main/conversation/ConversationService.ts', 'utf8');
const conversationTurnRunnerSource = fs.readFileSync('src/main/conversation/ConversationTurnRunner.ts', 'utf8');
const conversationCanonicalSources = `${conversationServiceSource}\n${conversationTurnRunnerSource}`;
const traceCanonicalSource = fs.readFileSync('src/main/agent-trace/TraceService.ts', 'utf8');
const kimiSurface = getLoadedProviderSurface('kimi-coding-plan');

assert(kimiSurface?.routes.length === 2, 'Kimi must retain both declared protocol routes.');
assert(kimiSurface?.routes.every((route) => route.contracts.reasoning.semantic === 'raw'), 'Every Kimi protocol route must explicitly declare raw reasoning.');
assert(!resolverSource.includes('RAW_REASONING_PROVIDER_IDS'), 'Reasoning resolver must not restore provider-id raw lists.');
assert(!resolverSource.includes('api-docs.deepseek.com'), 'Reasoning evidence URLs belong to strict manifests, not TypeScript.');
assert(resolverSource.includes('route.contracts?.reasoning'), 'Reasoning resolver must consume the frozen route contract.');
assert(builderSource.includes('PROVIDER_STREAM_CHANNEL_COLLISION'), 'Provider builder must fail closed on channel collisions.');
assert(builderSource.includes('PROVIDER_STREAM_EVENT_AFTER_TERMINAL'), 'Provider builder must reject semantic events after terminal.');
assert(!traceServiceSource.includes('emitThoughtFromText'), 'Conversation text must never be synthesized into trace thinking.');
assert(!traceEmitterSource.includes("event.type === 'assistant.completed'"), 'assistant.completed text must not create thought nodes.');
assert(!traceEmitterSource.includes("event.type === 'message_end'"), 'core message_end text must not create thought nodes.');
assert(!traceEmitterSource.includes('synthesizeFromConversation'), 'Conversation-wide thought synthesis must remain removed.');
assert(canonicalOutputSource.includes("outputPhase !== 'final_answer'"), 'Canonical output reducer must allow only final_answer to write assistant final text.');
assert(canonicalOutputSource.includes('PROVIDER_STREAM_MISSING_FINAL_ANSWER'), 'Canonical output reducer must fail closed when final_answer is absent.');
assert(conversationTurnRunnerSource.includes('requireCanonicalFinalAnswer(canonicalOutput)'), 'Conversation terminal content must come from canonical final state.');
assert(!/event\.type === 'tool\.started'[\s\S]{0,240}beginAssistantContentLoop\(\)/u.test(conversationCanonicalSources), 'Tool lifecycle events must not consume the pending assistant loop transition.');
assert(!conversationCanonicalSources.includes('currentLoopText.trim() || rawResponse || visibleResponse'), 'Conversation terminal content must not fall back to loop text.');
assert(!conversationCanonicalSources.includes('rawResponse ||'), 'Conversation terminal content must not restore raw provider text fallback.');
assert(traceCanonicalSource.includes("block.result?.outputPhase === 'final_answer'"), 'Trace reload must read only explicit final_answer blocks.');
assert(openaiCompatibleSource.includes('Provider emitted another semantic Chat Completions choice after finish_reason.'), 'Chat Completions must reject semantic choices after finish_reason.');
assert(openaiResponsesSource.includes('providerTerminalSeen'), 'Responses must reject events after its terminal event.');

const unknownProvider = configuredProvider('custom-endpoint', 'OpenAICompatibleChatCompletions');
assert(resolveProviderReasoningContract(unknownProvider, effectiveModel(unknownProvider, 'unknown-model')).semantic === 'unknown', 'Undeclared third-party routes must remain unknown.');

console.log('[reasoning-delivery] OK');
