import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1, id: 'chutes', vendorId: 'chutes', label: 'Chutes', status: 'stable',
  availability: { state: 'unknown' }, category: 'third-party-compatible', catalogOwnership: 'user-managed',
  authModes: ['api-key'], capabilities: ['chat', 'tool-calling', 'model-discovery'],
  routes: [{ protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://llm.chutes.ai/v1', default: true }],
  userSelectableRoute: false,
  discovery: { kind: 'json-catalog', path: '/models', collectionPath: 'data', mapping: { id: 'id', label: 'name', contextWindow: 'context_length', modality: 'input_modalities' }, admission: { allowedModalities: ['text', 'image'] } },
  seedModels: [], overlays: [], recommendedModels: ['deepseek-ai/DeepSeek-V3.1'],
  docsUrl: 'https://docs.chutes.ai/',
};

export default preset;
