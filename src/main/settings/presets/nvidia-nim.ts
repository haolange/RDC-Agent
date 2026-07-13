import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1, id: 'nvidia-nim', vendorId: 'nvidia', label: 'NVIDIA NIM', status: 'stable',
  availability: { state: 'unknown' }, category: 'cloud-platform', catalogOwnership: 'user-managed',
  authModes: ['api-key'], capabilities: ['chat', 'tool-calling', 'model-discovery'],
  routes: [{ protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://integrate.api.nvidia.com/v1', default: true }],
  userSelectableRoute: false,
  discovery: { kind: 'json-catalog', path: '/models', collectionPath: 'data', mapping: { id: 'id', label: 'id', modality: 'type' }, admission: { denyPatterns: ['*embed*', '*rerank*', '*guard*', '*safety*'] } },
  seedModels: [], overlays: [], recommendedModels: ['deepseek-ai/deepseek-v4-pro', 'nvidia/nemotron-3-super-120b-a12b'],
  docsUrl: 'https://docs.api.nvidia.com/nim/reference/llm-apis',
};

export default preset;
