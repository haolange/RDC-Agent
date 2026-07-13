import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1,
  id: 'longcat',
  vendorId: 'longcat',
  label: 'LongCat',
  status: 'stable',
  availability: { state: 'unknown' },
  category: 'official-direct',
  catalogOwnership: 'app-managed',
  authModes: ['api-key'],
  capabilities: ['chat', 'tool-calling', 'reasoning', 'model-discovery'],
  routes: [
    { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://api.longcat.chat/openai/v1', default: true },
    { protocol: 'AnthropicMessages', baseUrl: 'https://api.longcat.chat/anthropic/v1' },
  ],
  userSelectableRoute: true,
  discovery: {
    kind: 'json-catalog',
    url: 'https://api.longcat.chat/v1/models',
    collectionPath: 'data',
    mapping: { id: 'id' },
    admission: { allowPatterns: ['LongCat-*'], allowedModalities: ['text'] },
    modelSet: 'authoritative',
  },
  seedModels: [{
    modelId: 'LongCat-2.0',
    label: 'LongCat 2.0',
    aliases: [],
    route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://api.longcat.chat/openai/v1', source: 'preset' },
    availability: 'available',
    contextTiers: [{
      id: 'default', label: 'Default', maxPromptTokens: 1_048_576, maxOutputTokens: 131_072,
      activation: { kind: 'implicit' }, entitlement: 'granted',
    }],
    defaultBudgetTokens: 256_000,
    fast: { kind: 'unsupported' },
    reasoning: {
      kind: 'toggle', supportsOff: true, levels: [], defaultSelection: 'on',
      wireProfile: {
        kind: 'openai-compatible', on: 'high', onMode: 'thinking-enabled', offMode: 'thinking-disabled',
      },
    },
    toolCalling: { state: 'supported' },
    visionInput: { state: 'unsupported' },
    structuredOutput: { state: 'unknown' },
  }],
  overlays: [{
    modelId: 'LongCat-2.0',
    protocol: 'AnthropicMessages',
    patch: {
      reasoning: {
        kind: 'toggle', supportsOff: true, levels: [], defaultSelection: 'on',
        wireProfile: { kind: 'anthropic', on: 'high', onMode: 'enabled', offMode: 'disabled' },
      },
    },
  }],
  recommendedModels: ['LongCat-2.0'],
  docsUrl: 'https://longcat.chat/platform/docs/api/models',
};

export default preset;
