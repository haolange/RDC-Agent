import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1,
  id: 'opencode-zen',
  vendorId: 'opencode',
  label: 'OpenCode Zen',
  status: 'stable',
  availability: { state: 'unknown' },
  category: 'third-party-compatible',
  catalogOwnership: 'app-managed',
  authModes: ['api-key'],
  capabilities: ['chat', 'tool-calling', 'reasoning', 'model-discovery'],
  routes: [
    { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://opencode.ai/zen/v1', default: true },
    { protocol: 'OpenAIResponses', baseUrl: 'https://opencode.ai/zen/v1' },
    { protocol: 'AnthropicMessages', baseUrl: 'https://opencode.ai/zen/v1' },
  ],
  userSelectableRoute: false,
  discovery: {
    kind: 'json-catalog',
    url: 'https://opencode.ai/zen/v1/models',
    collectionPath: 'data',
    mapping: { id: 'id', label: 'name', contextWindow: 'limit.context', modality: 'modalities.input' },
    admission: { allowedModalities: ['text', 'image'], denyPatterns: ['gemini-*'] },
    routeRules: [
      {
        allowPatterns: ['gpt-*'], protocol: 'OpenAIResponses', baseUrl: 'https://opencode.ai/zen/v1',
      },
      {
        allowPatterns: ['claude-*', 'qwen3.*'], protocol: 'AnthropicMessages', baseUrl: 'https://opencode.ai/zen/v1',
      },
      {
        allowPatterns: ['*'], protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://opencode.ai/zen/v1',
      },
    ],
    modelSet: 'authoritative',
  },
  seedModels: [
    {
      modelId: 'gpt-5.5', label: 'GPT-5.5', aliases: [],
      route: { protocol: 'OpenAIResponses', baseUrl: 'https://opencode.ai/zen/v1', source: 'model' },
      availability: 'available',
      contextTiers: [{ id: 'default', label: 'Default', maxPromptTokens: 272_000, activation: { kind: 'implicit' }, entitlement: 'unknown' }],
      defaultBudgetTokens: 256_000,
      fast: { kind: 'unsupported' },
      reasoning: {
        kind: 'levels', supportsOff: true, levels: ['low', 'medium', 'high', 'extra'], defaultSelection: 'medium',
        wireProfile: { kind: 'openai-responses', on: 'medium', levels: { low: 'low', medium: 'medium', high: 'high', extra: 'xhigh' } },
      },
      toolCalling: { state: 'supported' }, visionInput: { state: 'supported' }, structuredOutput: { state: 'unknown' },
    },
    {
      modelId: 'claude-opus-4-7', label: 'Claude Opus 4.7', aliases: [],
      route: { protocol: 'AnthropicMessages', baseUrl: 'https://opencode.ai/zen/v1', source: 'model' },
      availability: 'available',
      contextTiers: [{ id: 'default', label: 'Default', maxPromptTokens: 200_000, activation: { kind: 'implicit' }, entitlement: 'unknown' }],
      defaultBudgetTokens: 200_000,
      fast: { kind: 'unsupported' },
      reasoning: {
        kind: 'levels', supportsOff: true, levels: ['low', 'medium', 'high', 'extra', 'max'], defaultSelection: 'high',
        wireProfile: { kind: 'anthropic', on: 'high', levels: { low: 'low', medium: 'medium', high: 'high', extra: 'xhigh', max: 'max' }, onMode: 'adaptive', offMode: 'disabled' },
      },
      toolCalling: { state: 'supported' }, visionInput: { state: 'supported' }, structuredOutput: { state: 'unknown' },
    },
    {
      modelId: 'qwen3.6-plus', label: 'Qwen3.6 Plus', aliases: [],
      route: { protocol: 'AnthropicMessages', baseUrl: 'https://opencode.ai/zen/v1', source: 'model' },
      availability: 'available',
      contextTiers: [{ id: 'default', label: 'Default', activation: { kind: 'implicit' }, entitlement: 'unknown' }],
      defaultBudgetTokens: 256_000,
      fast: { kind: 'unsupported' },
      reasoning: { kind: 'toggle', supportsOff: true, levels: [], defaultSelection: 'on', wireProfile: { kind: 'anthropic', on: 'high', onMode: 'adaptive', offMode: 'disabled' } },
      toolCalling: { state: 'supported' }, visionInput: { state: 'unknown' }, structuredOutput: { state: 'unknown' },
    },
  ],
  overlays: [],
  recommendedModels: ['gpt-5.5', 'claude-opus-4-7', 'qwen3.6-plus'],
  docsUrl: 'https://opencode.ai/docs/zen/',
};

export default preset;
