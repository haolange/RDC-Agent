import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1, id: 'fireworks-ai', vendorId: 'fireworks', label: 'Fireworks AI', status: 'stable',
  availability: { state: 'unknown' }, category: 'third-party-compatible', catalogOwnership: 'user-managed',
  authModes: ['api-key'], capabilities: ['chat', 'tool-calling', 'reasoning', 'model-discovery'],
  routes: [{ protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://api.fireworks.ai/inference/v1', default: true }],
  userSelectableRoute: false,
  discovery: { kind: 'json-catalog', path: '/models', collectionPath: 'data', mapping: { id: 'id', label: 'display_name', contextWindow: 'context_length', modality: 'type' }, admission: { allowedModalities: ['chat', 'language'] } },
  seedModels: [], overlays: [], recommendedModels: ['accounts/fireworks/models/deepseek-v4-pro'],
  docsUrl: 'https://docs.fireworks.ai/getting-started/quickstart',
};

export default preset;
