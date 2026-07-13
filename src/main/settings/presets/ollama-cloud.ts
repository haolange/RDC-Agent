import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  schemaVersion: 1, id: 'ollama-cloud', vendorId: 'ollama', label: 'Ollama Cloud', status: 'stable',
  availability: { state: 'unknown' }, category: 'official-compatible', catalogOwnership: 'user-managed',
  authModes: ['api-key'], capabilities: ['chat', 'tool-calling', 'model-discovery'],
  routes: [{ protocol: 'OllamaOpenAICompatibleChatCompletions', baseUrl: 'https://ollama.com', default: true }],
  userSelectableRoute: false,
  discovery: { kind: 'json-catalog', url: 'https://ollama.com/api/tags', collectionPath: 'models', mapping: { id: 'name', label: 'name' }, admission: { denyPatterns: ['*embed*'] }, modelSet: 'authoritative' },
  seedModels: [], overlays: [], recommendedModels: ['deepseek-v4-flash', 'minimax-m3', 'qwen3.5:397b'],
  docsUrl: 'https://docs.ollama.com/cloud',
};

export default preset;
