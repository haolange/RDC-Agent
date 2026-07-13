import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1, id: 'chutes', vendorId: 'chutes', label: 'Chutes', status: 'stable',
  availability: { state: 'unknown' }, category: 'third-party-compatible', catalogOwnership: 'app-managed',
  authModes: ['api-key'], capabilities: ['chat', 'tool-calling', 'model-discovery'],
  routes: [{ protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://llm.chutes.ai/v1', default: true }],
  userSelectableRoute: false,
  discovery: {
    kind: 'json-catalog', path: '/models', collectionPath: 'data',
    mapping: {
      id: 'id', contextWindow: 'context_length', contextWindowKind: 'prompt',
      maxOutputTokens: 'max_output_length', modality: 'input_modalities',
      toolCalling: { path: 'supported_features', includes: 'tools' },
      visionInput: { path: 'input_modalities', includes: 'image' },
      structuredOutput: { path: 'supported_features', includes: 'structured_outputs' },
    },
    admission: { allowedModalities: ['text', 'image'] },
    modelSet: 'authoritative',
  },
  seedModels: [], overlays: [], recommendedModels: ['Qwen/Qwen3-32B-TEE', 'google/gemma-4-31B-turbo-TEE'],
  docsUrl: 'https://chutes.ai/docs/',
};

export default preset;
