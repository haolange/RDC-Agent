import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1, id: 'together-ai', vendorId: 'together', label: 'Together AI', status: 'stable',
  availability: { state: 'unknown' }, category: 'third-party-compatible', catalogOwnership: 'app-managed',
  authModes: ['api-key'], capabilities: ['chat', 'tool-calling', 'structured-output', 'vision-input', 'model-discovery'],
  routes: [{ protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://api.together.ai/v1', default: true }],
  userSelectableRoute: false,
  discovery: { kind: 'json-catalog', path: '/models', collectionPath: '$', mapping: { id: 'id', label: 'display_name', contextWindow: 'context_length', modality: 'type' }, admission: { allowedModalities: ['chat', 'language', 'code'] }, modelSet: 'authoritative' },
  seedModels: [], overlays: [], recommendedModels: ['openai/gpt-oss-120b', 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8'],
  docsUrl: 'https://docs.together.ai/docs/inference/openai-compatibility',
};

export default preset;
