import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1, id: 'fireworks-ai', vendorId: 'fireworks', label: 'Fireworks AI', status: 'stable',
  availability: { state: 'unknown' }, category: 'third-party-compatible', catalogOwnership: 'app-managed',
  authModes: ['api-key'], capabilities: ['chat', 'tool-calling', 'reasoning', 'model-discovery'],
  routes: [{ protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://api.fireworks.ai/inference/v1', default: true }],
  userSelectableRoute: false,
  discovery: {
    kind: 'json-catalog',
    url: 'https://api.fireworks.ai/v1/accounts/fireworks/models?filter=supports_serverless%3Dtrue',
    collectionPath: 'models',
    mapping: {
      id: 'name', label: 'displayName', contextWindow: 'contextLength',
      toolCalling: { path: 'supportsTools' }, visionInput: { path: 'supportsImageInput' },
    },
    admission: { requireContextWindow: true, denyPatterns: ['*embed*', '*rerank*', '*guard*'] },
    modelSet: 'authoritative',
  },
  seedModels: [], overlays: [], recommendedModels: ['accounts/fireworks/models/deepseek-v4-pro'],
  docsUrl: 'https://docs.fireworks.ai/getting-started/quickstart',
};

export default preset;
