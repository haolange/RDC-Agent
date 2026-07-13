import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1, id: 'lm-studio', vendorId: 'lm-studio', label: 'LM Studio', status: 'stable',
  availability: { state: 'unknown' }, category: 'local', catalogOwnership: 'user-managed',
  authModes: ['local'], baseUrlEditable: true, capabilities: ['chat', 'tool-calling', 'model-discovery'],
  routes: [
    { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'http://127.0.0.1:1234/v1', default: true },
    { protocol: 'OpenAIResponses', baseUrl: 'http://127.0.0.1:1234/v1' },
  ],
  userSelectableRoute: true,
  discovery: { kind: 'json-catalog', path: '/models', collectionPath: 'data', mapping: { id: 'id', label: 'id' }, admission: { denyPatterns: ['*embed*', '*rerank*'] } },
  seedModels: [], overlays: [], recommendedModels: [],
  docsUrl: 'https://lmstudio.ai/docs/developer/openai-compat/models',
};

export default preset;
